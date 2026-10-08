#!/system/bin/sh
MODDIR=${0%/*}
if [ "$(id -u)" != 0 ]; then
    echo 'CROSSSIM_RESULT:{"ok":false,"error":"请通过 root 管理器的模块界面运行"}'
    exit 1
fi
export CLASSPATH="$MODDIR/bridge.jar"
[ -s "$CLASSPATH" ] || {
    echo 'CROSSSIM_RESULT:{"ok":false,"uid":0,"error":"bridge.jar missing; reinstall the module"}'
    exit 1
}
[ -x /system/bin/app_process ] || {
    echo 'CROSSSIM_RESULT:{"ok":false,"uid":0,"error":"app_process is unavailable on this ROM"}'
    exit 1
}
if [ "${1:-}" = "check" ]; then
    exec /system/bin/app_process /system/bin com.yuhao7370.crosssim.RootBridge probe 0 0
fi
case "${1:-}" in on|off|toggle-secondary)
    if [ -f "$MODDIR/disable" ] || [ -f "$MODDIR/remove" ]; then
        echo 'CROSSSIM_RESULT:{"ok":false,"uid":0,"error":"Module is disabled or pending removal"}'
        exit 1
    fi ;;
esac
exec /system/bin/app_process /system/bin com.yuhao7370.crosssim.ModuleBridge "$@"
