package main

// 便携数据目录（自定义 opencode 数据/配置位置）：把 opencode 的配置/数据/缓存/状态
// 统一放到程序目录下的 agentdatas，通过设置 XDG 环境变量实现。
//
// 目录布局（与可执行文件同级）：
//
//	<exeDir>/agentdatas/
//	  config/opencode/   ← XDG_CONFIG_HOME（配置）
//	  data/opencode/     ← XDG_DATA_HOME（会话数据、凭据）
//	  cache/opencode/    ← XDG_CACHE_HOME（缓存，可再生）
//	  state/opencode/    ← XDG_STATE_HOME（服务注册 service.json）
//	  runtime/           ← XDG_RUNTIME_DIR（Linux 运行时目录）
//
// 生效范围：仅本进程的环境块，及其启动的子进程（opencode 服务、内置终端）；
// 不影响系统环境、已在运行的其他程序、用户自己开的终端。
//
// ⚠ 默认关闭：本功能会把 opencode 的数据**分裂**成两套（系统 XDG 一套、程序目录
// 一套），导致同一台机器上不同入口看到的会话/凭据/服务注册不一致。因此默认走系统
// XDG 路径，只有显式开启才启用。开启方式见 portableModeEnabled。

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"oc-manager/internal/logger"
)

// portableDataRootName 便携数据根目录名（与可执行文件同级）。
const portableDataRootName = "agentdatas"

// portableFlagFileName 便携模式开关文件名（与可执行文件同级）。
// 内容为 JSON：{"portable": true}
const portableFlagFileName = "portable.json"

// portableEnvVar 便携模式开关环境变量名。
// 取值 1/true/on/yes 表示开启，0/false/off/no 表示关闭；设置后优先于开关文件。
const portableEnvVar = "OC_MANAGER_PORTABLE"

// portableXdgDirs 环境变量 → agentdatas 下的子目录。
var portableXdgDirs = []struct {
	Env    string
	SubDir string
}{
	{"XDG_CONFIG_HOME", "config"},
	{"XDG_DATA_HOME", "data"},
	{"XDG_CACHE_HOME", "cache"},
	{"XDG_STATE_HOME", "state"},
	{"XDG_RUNTIME_DIR", "runtime"},
}

// setupPortableXDG 在程序启动最早期把 5 个 XDG 环境变量指向程序目录下的
// agentdatas/<子目录>（即"便携模式"）。
//
// 开关语义（portableModeEnabled）：
//   - 默认关闭：不创建 agentdatas、不设置任何 XDG 变量，opencode 完全走系统路径；
//   - 显式开启：强制覆盖 5 个 XDG 变量（便携模式必须稳定，不受系统已有 XDG 影响）。
//
// 设计取舍：
//   - 失败不阻断启动：创建目录/设置变量失败只记录日志，后续按默认环境继续；
//   - 检测"已有服务/目录"的读取仍在各自的业务逻辑中显式进行，不依赖本函数。
func setupPortableXDG() {
	if !portableModeEnabled() {
		// 默认路径：与功能引入前完全一致（零 XDG 改动、不建目录）。
		logger.Printf("[portable] 便携数据目录未启用（默认关闭），opencode 使用系统 XDG 路径；"+
			"开启方式：设置环境变量 %s=1，或在程序目录放 %s（内容 {\"portable\": true}）",
			portableEnvVar, portableFlagFileName)
		return
	}

	exePath, err := os.Executable()
	if err != nil {
		logger.Printf("[portable] 已开启但获取可执行文件路径失败，回退系统 XDG 路径: %v", err)
		return
	}
	applyPortableXDG(filepath.Join(filepath.Dir(exePath), portableDataRootName))
}

// applyPortableXDG 在 base 下创建 5 个子目录，并把对应 XDG 变量指向它们。
// 拆成独立函数是为了让「开启后的副作用」可在临时目录上单测，不碰真实环境。
func applyPortableXDG(base string) {
	for _, item := range portableXdgDirs {
		dir := filepath.Join(base, item.SubDir)
		if err := os.MkdirAll(dir, 0o700); err != nil {
			logger.Printf("[portable] 创建目录失败 %s: %v", dir, err)
			continue
		}
		if err := os.Setenv(item.Env, dir); err != nil {
			logger.Printf("[portable] 设置环境变量失败 %s=%s: %v", item.Env, dir, err)
			continue
		}
	}
	logger.Printf("[portable] 便携数据目录已启用: %s", base)
}

// portableModeEnabled 判断便携模式是否开启。判定顺序：
//
//  1. 环境变量 OC_MANAGER_PORTABLE（最高优先，便于临时切换与脚本化）；
//  2. 程序目录下的 portable.json 的 "portable" 布尔字段；
//  3. 都没有 → false（默认关闭）。
//
// 任何解析失败都按"未开启"处理并记录日志：宁可保持默认路径，也不要因为一个
// 坏配置文件把用户的数据悄悄搬到别处。
func portableModeEnabled() bool {
	exePath, err := os.Executable()
	if err != nil {
		// 取不到程序目录时仍尊重环境变量（那一步不依赖 exe 路径）。
		return portableModeEnabledFrom("", err)
	}
	return portableModeEnabledFrom(filepath.Dir(exePath), nil)
}

// portableModeEnabledFrom 是 portableModeEnabled 的可测实现：exeDir 为空表示
// 取不到程序目录（此时跳过开关文件，只认环境变量）。
func portableModeEnabledFrom(exeDir string, exeErr error) bool {
	if raw, ok := os.LookupEnv(portableEnvVar); ok {
		if v, ok := parsePortableBool(raw); ok {
			return v
		}
		logger.Printf("[portable] 环境变量 %s=%q 无法识别（可用 1/true/on/yes 或 0/false/off/no），按未开启处理",
			portableEnvVar, raw)
		return false
	}

	if exeDir == "" {
		if exeErr != nil {
			logger.Printf("[portable] 获取可执行文件路径失败，跳过开关文件: %v", exeErr)
		}
		return false
	}
	flagPath := filepath.Join(exeDir, portableFlagFileName)
	raw, err := os.ReadFile(flagPath)
	if err != nil {
		if !os.IsNotExist(err) {
			logger.Printf("[portable] 读取开关文件失败 %s: %v（按未开启处理）", flagPath, err)
		}
		return false
	}
	enabled, found, err := parsePortableFlag(raw)
	if err != nil {
		logger.Printf("[portable] 开关文件 %s 解析失败: %v（按未开启处理）", flagPath, err)
		return false
	}
	if !found {
		logger.Printf("[portable] 开关文件 %s 缺少 \"portable\" 布尔字段，按未开启处理", flagPath)
		return false
	}
	return enabled
}

// portableFlagDoc 是 portable.json 的结构。只认 "portable" 一个字段，
// 用指针区分「没写」与「写了 false」——后者同样表示显式关闭。
type portableFlagDoc struct {
	Portable *bool `json:"portable"`
}

// parsePortableFlag 解析 portable.json 内容。
// 返回值：是否开启、是否显式提供了该字段、解析错误。
func parsePortableFlag(raw []byte) (enabled bool, found bool, err error) {
	var doc portableFlagDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		return false, false, err
	}
	if doc.Portable == nil {
		return false, false, nil
	}
	return *doc.Portable, true, nil
}

// parsePortableBool 解析布尔开关的字符串写法。
// 返回值：解析结果、是否识别。无法识别时第二个返回值为 false。
func parsePortableBool(raw string) (value bool, ok bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "on", "yes", "y", "t":
		return true, true
	case "0", "false", "off", "no", "n", "f":
		return false, true
	default:
		return false, false
	}
}
