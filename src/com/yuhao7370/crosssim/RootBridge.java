package com.yuhao7370.crosssim;

import android.os.IBinder;
import android.os.Process;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import org.json.JSONObject;

/** Runs in a short-lived root app_process invoked by the module. */
public final class RootBridge {
    private static final String PREFIX = "CROSSSIM_RESULT:";

    static Object service(String name, String apiName) throws Exception {
        IBinder binder = (IBinder) Class.forName("android.os.ServiceManager")
                .getMethod("getService", String.class).invoke(null, name);
        if (binder == null) throw new IllegalStateException(name + " service unavailable");
        return Class.forName(apiName + "$Stub").getMethod("asInterface", IBinder.class).invoke(null, binder);
    }

    static void requireActive(Object subscriptions, Class<?> api, int subId, int slot) throws Exception {
        int[] ids = (int[]) api.getMethod("getActiveSubIdList", boolean.class).invoke(subscriptions, false);
        boolean active = false;
        if (ids != null) for (int id : ids) if (id == subId) active = true;
        int actualSlot = (Integer) api.getMethod("getSlotIndex", int.class).invoke(subscriptions, subId);
        if (!active || actualSlot != slot) {
            throw new IllegalStateException("SIM 已切换或尚未就绪，停止操作。请等待自动刷新。");
        }
    }

    public static void main(String[] args) {
        JSONObject out = new JSONObject();
        int exitCode = 0;
        try {
            if (args.length != 3 || !(args[0].equals("status") || args[0].equals("on")
                    || args[0].equals("off") || args[0].equals("probe"))) {
                throw new IllegalArgumentException("Expected status|on|off|probe, subscription ID and slot index");
            }
            int subId = Integer.parseInt(args[1]);
            if (subId < 0) throw new IllegalArgumentException("Invalid subscription ID");
            int slot = Integer.parseInt(args[2]);
            if (slot < 0) throw new IllegalArgumentException("Invalid slot index");
            Class<?> api = Class.forName("com.android.internal.telephony.ITelephony");
            Method getter = api.getMethod("isCrossSimCallingEnabledByUser", int.class);
            Method setter = api.getMethod("setCrossSimCallingEnabled", int.class, boolean.class);
            Class<?> subApi = Class.forName("com.android.internal.telephony.ISub");
            subApi.getMethod("getActiveSubIdList", boolean.class);
            subApi.getMethod("getSlotIndex", int.class);
            out.put("subId", subId);
            out.put("uid", Process.myUid());
            if (args[0].equals("probe")) {
                // Checks this ROM's API shape without reading or changing settings.
                out.put("apiAvailable", true);
            } else {
                if (Process.myUid() != 0) throw new SecurityException("Root authorization required (uid != 0)");
                Object phone = service("phone", api.getName());
                Object subscriptions = service("isub", subApi.getName());
                requireActive(subscriptions, subApi, subId, slot);
                boolean before = (Boolean) getter.invoke(phone, subId);
                boolean enabled = before;
                out.put("before", before);
                if (!args[0].equals("status")) {
                    boolean requested = args[0].equals("on");
                    // Authorization may take time: revalidate immediately before the write.
                    requireActive(subscriptions, subApi, subId, slot);
                    setter.invoke(phone, subId, requested);
                    for (int i = 0; i < 8; i++) {
                        enabled = (Boolean) getter.invoke(phone, subId);
                        if (enabled == requested) break;
                        Thread.sleep(250);
                    }
                    if (enabled != requested) {
                        throw new IllegalStateException("系统未接受开关设置，回读状态不一致。可能受 IMS 开通状态或厂商实现限制。");
                    }
                }
                requireActive(subscriptions, subApi, subId, slot);
                out.put("enabled", enabled);
            }
            out.put("ok", true);
        } catch (Throwable error) {
            while (error instanceof InvocationTargetException && error.getCause() != null) {
                error = error.getCause();
            }
            try {
                out.put("ok", false);
                out.put("error", error.getClass().getSimpleName() + ": " + error.getMessage());
            } catch (Exception ignored) { }
            exitCode = 1;
        }
        System.out.println(PREFIX + out);
        System.out.flush();
        System.exit(exitCode);
    }
}
