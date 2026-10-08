SKIPMOUNT=true
PROPFILE=false
POSTFSDATA=false
LATESTARTSERVICE=false

CROSSSIM_API=${API:-$(/system/bin/getprop ro.build.version.sdk)}
case "$CROSSSIM_API" in ''|*[!0-9]*) abort "Cannot determine Android API level" ;; esac
[ "$CROSSSIM_API" -ge 31 ] || abort "需要 Android 12 或更高版本 / Android 12+ required"
[ -s "$MODPATH/bridge.jar" ] || abort "Missing bridge.jar"
[ -f "$MODPATH/control.sh" ] || abort "Missing control.sh"
[ -f "$MODPATH/webroot/index.html" ] || abort "Missing WebUI"

CROSSSIM_MANAGER="Unknown compatible installer"
if [ "${KSU:-}" = "true" ] || [ -n "${KSU_KERNEL_VER_CODE:-}" ]; then
    CROSSSIM_MANAGER="KernelSU family (including SukiSU)"
elif [ -n "${APATCH:-}" ] || [ -n "${APATCH_VER:-}" ]; then
    CROSSSIM_MANAGER="APatch"
elif [ -n "${MAGISK_VER_CODE:-}" ]; then
    CROSSSIM_MANAGER="Magisk"
fi
ui_print "Cross-SIM"
ui_print "Root manager: $CROSSSIM_MANAGER"
ui_print "KSU / SukiSU：安装生效后打开模块 WebUI。"
ui_print "执行 / Action：查看 SIM 和跨卡通话开关状态。"
ui_print "Magisk 图形界面：使用 KsuWebUI / WebUI X 等兼容宿主。"
if [ "$CROSSSIM_MANAGER" = "Magisk" ]; then
    case "$MAGISK_VER_CODE" in ''|*[!0-9]*) ;; *)
        if [ "$MAGISK_VER_CODE" -lt 28000 ]; then
            ui_print "This Magisk version has no native module Action button; use a WebUI host or root CLI."
        fi ;;
    esac
fi
ui_print "Cross-SIM 无独立 APK；WebUI 宿主需有 root / shell 权限。"
set_perm "$MODPATH/action.sh" 0 0 0755
set_perm "$MODPATH/control.sh" 0 0 0755
set_perm "$MODPATH/bridge.jar" 0 0 0644
