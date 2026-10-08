#!/system/bin/sh
MODDIR=${0%/*}

printf 'Cross-SIM\n\n'
summary=$(/system/bin/sh "$MODDIR/control.sh" summary en 2>/dev/null)
result=$?
if [ "$result" = 0 ]; then
    printf '%s\n' "$summary"
else
    printf 'Status unavailable. Try again shortly.\n'
fi
exit "$result"
