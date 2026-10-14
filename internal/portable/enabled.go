// 便携模式开关（本包唯一入口：Enabled）。
//
// 语义沿革（2026-10-13 合并裁决）：上游 e0044c3 把便携定位重构进本包
// （helper + ChildEnvFrom 子进程注入，刻意不改进程级 XDG——否则 libibus
// 找不到 ibus/bus，GTK/WebView 中文输入法整体失效），该架构我方采纳；
// 但上游把便携做成了**恒开**，推翻了我方「默认关闭」的裁决（曾把用户
// 数据静默搬到 exe 同级目录）。本文件把开关链移植回来：
//
//	1. 环境变量 OC_MANAGER_PORTABLE（最高优先，便于临时切换与脚本化）；
//	2. 程序目录下的 portable.json 的 "portable" 布尔字段；
//	3. 都没有 → false（默认关闭）。
//
// 关闭时 Root() 返回空串，本包所有 helper 随之为空，调用方按既有的
// `if dir != ""` 分支回退系统路径；ChildEnv 返回 nil，子进程保持系统
// 环境。整个包因此天然退化为「非便携」。
//
// 任何解析失败都按「未开启」处理并记录日志：宁可保持默认路径，也不要
// 因为一个坏配置文件把用户的数据悄悄搬到别处。
package portable

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"oc-manager/internal/logger"
)

const (
	// EnvVar 是便携开关环境变量名（最高优先级）。
	EnvVar = "OC_MANAGER_PORTABLE"
	// flagFileName 是程序目录下的开关文件名。
	flagFileName = "portable.json"
)

var (
	enabledOnce sync.Once
	enabledVal  bool
)

// Enabled 返回便携模式是否开启。判定结果进程内只计算一次（sync.Once）：
// 开关文件在程序启动时读取，运行中修改不生效，需重启。
func Enabled() bool {
	enabledOnce.Do(func() {
		exePath, err := os.Executable()
		if err != nil {
			enabledVal = enabledFrom("", err)
			return
		}
		enabledVal = enabledFrom(filepath.Dir(exePath), nil)
	})
	return enabledVal
}

// enabledFrom 是 Enabled 的可测实现：exeDir 为空表示取不到程序目录
// （此时跳过开关文件，只认环境变量）。
func enabledFrom(exeDir string, exeErr error) bool {
	if raw, ok := os.LookupEnv(EnvVar); ok {
		if v, ok := parseBool(raw); ok {
			return v
		}
		logger.Printf("[portable] 环境变量 %s=%q 无法识别（可用 1/true/on/yes 或 0/false/off/no），按未开启处理",
			EnvVar, raw)
		return false
	}

	if exeDir == "" {
		if exeErr != nil {
			logger.Printf("[portable] 获取可执行文件路径失败，跳过开关文件: %v", exeErr)
		}
		return false
	}
	flagPath := filepath.Join(exeDir, flagFileName)
	raw, err := os.ReadFile(flagPath)
	if err != nil {
		if !os.IsNotExist(err) {
			logger.Printf("[portable] 读取开关文件失败 %s: %v（按未开启处理）", flagPath, err)
		}
		return false
	}
	enabled, found, err := parseFlag(raw)
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

// flagDoc 是 portable.json 的结构。只认 "portable" 一个字段，
// 用指针区分「没写」与「写了 false」——后者同样表示显式关闭。
type flagDoc struct {
	Portable *bool `json:"portable"`
}

// parseFlag 解析 portable.json 内容。
// 返回值：是否开启、是否显式提供了该字段、解析错误。
func parseFlag(raw []byte) (enabled bool, found bool, err error) {
	var doc flagDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		return false, false, err
	}
	if doc.Portable == nil {
		return false, false, nil
	}
	return *doc.Portable, true, nil
}

// parseBool 解析布尔开关的字符串写法。
// 返回值：解析结果、是否识别。无法识别时第二个返回值为 false。
func parseBool(raw string) (value bool, ok bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "on", "yes", "y", "t":
		return true, true
	case "0", "false", "off", "no", "n", "f":
		return false, true
	default:
		return false, false
	}
}
