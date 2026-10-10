package main

// 便携数据目录开关（portable.go）的回归测试。
//
// 为什么必须测：
//   该功能会把 opencode 的数据搬到程序目录下的 agentdatas，形成**与系统 XDG
//   并列的第二套数据**（会话/凭据/服务注册各一套）。一旦默认值或开关判定出错，
//   用户会在两个入口看到不同的数据，且不易察觉。因此这里把「默认关闭」与
//   「开启后的副作用」都钉死。
//
// 反向断言（重新引入 bug 必须让本文件失败）：
//   - 去掉默认关闭 → 「没有任何开关来源时应保持关闭」失败；
//   - 把 parsePortableBool 改成恒 true → 「环境变量显式关闭优先于开关文件」失败；
//   - 把 parsePortableBool 改成恒 false → 「环境变量显式开启」失败；
//   - 开关文件解析失败改成放行 → 「坏配置按未开启处理」失败；
//   - 开启分支漏掉某个 XDG 变量 → 「开启后 5 个 XDG 变量全部指向 base」失败。
import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// withPortableEnv 保存/清理便携开关相关的环境变量，避免测试间互相污染。
func withPortableEnv(t *testing.T) {
	t.Helper()
	for _, k := range append([]string{portableEnvVar}, xdgEnvNames()...) {
		if v, ok := os.LookupEnv(k); ok {
			t.Cleanup(func() { _ = os.Setenv(k, v) })
		} else {
			t.Cleanup(func() { _ = os.Unsetenv(k) })
		}
		_ = os.Unsetenv(k)
	}
}

func xdgEnvNames() []string {
	names := make([]string, 0, len(portableXdgDirs))
	for _, d := range portableXdgDirs {
		names = append(names, d.Env)
	}
	return names
}

func writeFlagFile(t *testing.T, dir, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, portableFlagFileName), []byte(content), 0o600); err != nil {
		t.Fatalf("写开关文件失败: %v", err)
	}
}

// ===== 默认关闭 =====

func TestPortableDefaultOffWhenNoSwitchSource(t *testing.T) {
	withPortableEnv(t)
	dir := t.TempDir() // 空目录：既无环境变量也无开关文件
	if portableModeEnabledFrom(dir, nil) {
		t.Fatal("默认必须关闭：没有任何开关来源时却启用了便携模式")
	}
}

func TestPortableOffWhenFlagFileAbsent(t *testing.T) {
	withPortableEnv(t)
	if portableModeEnabledFrom(t.TempDir(), nil) {
		t.Fatal("目录下无 portable.json 时应关闭")
	}
}

func TestPortableOffWhenExeDirUnknown(t *testing.T) {
	withPortableEnv(t)
	if portableModeEnabledFrom("", os.ErrNotExist) {
		t.Fatal("取不到程序目录（且无环境变量）时应关闭，不能误启用")
	}
}

// ===== 环境变量通道 =====

func TestPortableEnvEnables(t *testing.T) {
	for _, v := range []string{"1", "true", "TRUE", " on ", "Yes", "y", "t"} {
		t.Run("env="+v, func(t *testing.T) {
			withPortableEnv(t)
			t.Setenv(portableEnvVar, v)
			// 即使目录里有「关闭」的开关文件，环境变量也应优先
			dir := t.TempDir()
			writeFlagFile(t, dir, `{"portable": false}`)
			if !portableModeEnabledFrom(dir, nil) {
				t.Fatalf("环境变量 %s=%q 应开启", portableEnvVar, v)
			}
		})
	}
}

func TestPortableEnvDisablesOverridesFlagFile(t *testing.T) {
	withPortableEnv(t)
	t.Setenv(portableEnvVar, "0")
	dir := t.TempDir()
	writeFlagFile(t, dir, `{"portable": true}`) // 文件说要开，环境变量说关
	if portableModeEnabledFrom(dir, nil) {
		t.Fatal("环境变量显式关闭必须优先于开关文件，否则用户关不掉")
	}
}

func TestPortableEnvUnrecognizedFallsBackToOff(t *testing.T) {
	for _, v := range []string{"", "maybe", "2", "-1", "onn"} {
		t.Run("env="+v, func(t *testing.T) {
			withPortableEnv(t)
			t.Setenv(portableEnvVar, v)
			dir := t.TempDir()
			writeFlagFile(t, dir, `{"portable": true}`)
			if portableModeEnabledFrom(dir, nil) {
				t.Fatalf("无法识别的 %s=%q 必须按未开启处理（即使开关文件写着开启）", portableEnvVar, v)
			}
		})
	}
}

// ===== 开关文件通道 =====

func TestPortableFlagFileEnables(t *testing.T) {
	withPortableEnv(t)
	dir := t.TempDir()
	writeFlagFile(t, dir, `{"portable": true}`)
	if !portableModeEnabledFrom(dir, nil) {
		t.Fatal(`开关文件 {"portable": true} 应开启`)
	}
}

func TestPortableFlagFileExplicitFalse(t *testing.T) {
	withPortableEnv(t)
	dir := t.TempDir()
	writeFlagFile(t, dir, `{"portable": false}`)
	if portableModeEnabledFrom(dir, nil) {
		t.Fatal(`开关文件 {"portable": false} 必须关闭（显式 false 不是"没写"）`)
	}
}

func TestPortableFlagFileMissingFieldIsOff(t *testing.T) {
	withPortableEnv(t)
	dir := t.TempDir()
	writeFlagFile(t, dir, `{}`)
	if portableModeEnabledFrom(dir, nil) {
		t.Fatal("缺少 portable 字段必须按未开启处理，不能因为有文件就启用")
	}
}

func TestPortableFlagFileMalformedIsOff(t *testing.T) {
	for _, bad := range []string{`{`, `not json`, `{"portable": "yes"}`, `[1,2,3]`, `{"portable": null}`} {
		t.Run("bad="+bad, func(t *testing.T) {
			withPortableEnv(t)
			dir := t.TempDir()
			writeFlagFile(t, dir, bad)
			if portableModeEnabledFrom(dir, nil) {
				t.Fatalf("坏配置 %q 必须按未开启处理", bad)
			}
		})
	}
}

// ===== 解析函数 =====

func TestParsePortableBool(t *testing.T) {
	cases := []struct {
		in   string
		want bool
		ok   bool
	}{
		{"1", true, true}, {"true", true, true}, {"ON", true, true},
		{"Yes", true, true}, {"  y  ", true, true}, {"t", true, true},
		{"0", false, true}, {"false", false, true}, {"Off", false, true},
		{"NO", false, true}, {"n", false, true}, {"f", false, true},
		{"", false, false}, {"maybe", false, false}, {"2", false, false},
	}
	for _, c := range cases {
		got, ok := parsePortableBool(c.in)
		if ok != c.ok || (ok && got != c.want) {
			t.Fatalf("parsePortableBool(%q) = (%v,%v), want (%v,%v)", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestParsePortableFlag(t *testing.T) {
	// 正常：true / false / 缺字段
	if v, found, err := parsePortableFlag([]byte(`{"portable":true}`)); err != nil || !found || !v {
		t.Fatalf("true 场景解析错: v=%v found=%v err=%v", v, found, err)
	}
	if v, found, err := parsePortableFlag([]byte(`{"portable":false}`)); err != nil || !found || v {
		t.Fatalf("false 场景解析错: v=%v found=%v err=%v", v, found, err)
	}
	if _, found, err := parsePortableFlag([]byte(`{}`)); err != nil || found {
		t.Fatalf("缺字段应返回 found=false: found=%v err=%v", found, err)
	}
	// 反向：非布尔类型不得被当成开启
	//   - "true"（字符串）/ 1（数字）：解析必须报错，否则字符串 truthy 会被误解为开启；
	//   - null：解成 nil（等同没写），不报错但结果必须是"未提供"→ 关闭。
	for _, raw := range []string{`{"portable":"true"}`, `{"portable":1}`} {
		if _, _, err := parsePortableFlag([]byte(raw)); err == nil {
			t.Fatalf("portable 为非布尔类型 %s 必须报错，避免字符串 \"true\" 被误解为开启", raw)
		}
	}
	if v, found, err := parsePortableFlag([]byte(`{"portable":null}`)); err != nil || found || v {
		t.Fatalf("portable=null 应按未提供处理（关闭）: v=%v found=%v err=%v", v, found, err)
	}
	// 反向：未知字段不得让整体解析失败（未来加字段时不破坏旧配置）
	if _, found, err := parsePortableFlag([]byte(`{"portable":true,"future":1}`)); err != nil || !found {
		t.Fatalf("存在未知字段时应能正常解析: found=%v err=%v", found, err)
	}
}

// ===== 副作用 =====

// TestApplyPortableXDGSetsAllVars 开启后 5 个 XDG 变量必须全部指向 base。
func TestApplyPortableXDGSetsAllVars(t *testing.T) {
	withPortableEnv(t)
	base := filepath.Join(t.TempDir(), portableDataRootName)
	applyPortableXDG(base)

	for _, d := range portableXdgDirs {
		want := filepath.Join(base, d.SubDir)
		if got := os.Getenv(d.Env); got != want {
			t.Fatalf("%s = %q, want %q（漏设置会让 opencode 仍走系统路径，造成两套数据混杂）", d.Env, got, want)
		}
		if fi, err := os.Stat(want); err != nil || !fi.IsDir() {
			t.Fatalf("目录 %s 未创建: err=%v", want, err)
		}
	}
}

// TestSetupPortableXDGDisabledHasNoSideEffect 关闭时调用 setupPortableXDG
// 必须零副作用：不改任何 XDG 变量、不创建 agentdatas。这是「默认不启动」的核心断言。
func TestSetupPortableXDGDisabledHasNoSideEffect(t *testing.T) {
	withPortableEnv(t)
	t.Setenv(portableEnvVar, "0") // 显式关闭

	// 记录调用前的 XDG 现场
	before := map[string]string{}
	present := map[string]bool{}
	for _, k := range xdgEnvNames() {
		before[k] = os.Getenv(k)
		if _, ok := os.LookupEnv(k); ok {
			present[k] = true
		}
	}

	setupPortableXDG()

	for _, k := range xdgEnvNames() {
		if os.Getenv(k) != before[k] {
			t.Fatalf("关闭时 %s 被改动: %q -> %q", k, before[k], os.Getenv(k))
		}
		if _, ok := os.LookupEnv(k); ok != present[k] {
			t.Fatalf("关闭时 %s 的存在性被改变", k)
		}
	}
}

// TestSetupPortableXDGEnabledCreatesData 端到端：环境变量开启 → 变量指向
// 程序目录下的 agentdatas（不是别处）。
func TestSetupPortableXDGEnabledCreatesData(t *testing.T) {
	withPortableEnv(t)
	t.Setenv(portableEnvVar, "1")
	setupPortableXDG()

	exePath, err := os.Executable()
	if err != nil {
		t.Skipf("取不到可执行文件路径: %v", err)
	}
	base := filepath.Join(filepath.Dir(exePath), portableDataRootName)
	if got := os.Getenv("XDG_CONFIG_HOME"); got != filepath.Join(base, "config") {
		t.Fatalf("XDG_CONFIG_HOME = %q, want %q", got, filepath.Join(base, "config"))
	}
	if fi, err := os.Stat(base); err != nil || !fi.IsDir() {
		t.Fatalf("agentdatas 未创建: err=%v", err)
	}
}

// TestPortableFlagJSONShapeIsStable 锁死开关文件的 JSON 形状（字段名单选
// "portable"），避免以后加字段时把默认值悄悄变成开启。
func TestPortableFlagJSONShapeIsStable(t *testing.T) {
	var doc portableFlagDoc
	if err := json.Unmarshal([]byte(`{"portable":true}`), &doc); err != nil {
		t.Fatalf("反序列化失败: %v", err)
	}
	if doc.Portable == nil || !*doc.Portable {
		t.Fatal("portable 字段未被正确绑定到指针")
	}
	var zero portableFlagDoc
	if zero.Portable != nil {
		t.Fatal("零值文档的 portable 指针必须为 nil（用于区分没写与写了 false）")
	}
}
