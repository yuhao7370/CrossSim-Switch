package com.yuhao7370.crosssim;

import android.os.Process;
import android.telephony.SubscriptionInfo;
import java.lang.reflect.InvocationTargetException;
import java.util.Arrays;
import java.util.Comparator;
import org.json.JSONArray;
import org.json.JSONObject;

/** Module entry point. The manager already runs this process as root; no su request is needed. */
public final class ModuleBridge {
    public static void main(String[] args) {
        boolean summary = args.length > 0 && args[0].equals("summary");
        boolean english = summary && !(args.length == 2 && args[1].equals("zh"));
        try {
            if (Process.myUid() != 0) throw new SecurityException("Module must be run by the root manager");
            if (args.length == 3 && (args[0].equals("status") || args[0].equals("on") || args[0].equals("off"))) {
                RootBridge.main(args);
                return;
            }
            boolean validSummary = summary && (args.length == 1 || (args.length == 2
                    && (args[1].equals("zh") || args[1].equals("en"))));
            if (!validSummary && (args.length != 1 || !(args[0].equals("list") || args[0].equals("toggle-secondary")))) {
                throw new IllegalArgumentException("Expected summary [zh|en], list, toggle-secondary or status|on|off <subId> <slot>");
            }
            Class<?> subApi = Class.forName("com.android.internal.telephony.ISub");
            Object subs = RootBridge.service("isub", subApi.getName());
            Class<?> phoneApi = Class.forName("com.android.internal.telephony.ITelephony");
            Object phone = RootBridge.service("phone", phoneApi.getName());
            int dataId = (Integer) subApi.getMethod("getDefaultDataSubId").invoke(subs);
            int[] ids = (int[]) subApi.getMethod("getActiveSubIdList", boolean.class).invoke(subs, false);
            JSONArray sims = new JSONArray();
            for (int id : ids) {
                int slot = (Integer) subApi.getMethod("getSlotIndex", int.class).invoke(subs, id);
                if (slot < 0) continue;
                JSONObject sim = new JSONObject().put("id", id).put("slot", slot).put("data", id == dataId);
                String name = "SIM " + (slot + 1);
                try {
                    SubscriptionInfo info = (SubscriptionInfo) subApi.getMethod("getActiveSubscriptionInfo",
                            int.class, String.class, String.class).invoke(subs, id, "com.android.shell", null);
                    if (info != null && info.getDisplayName() != null) name = info.getDisplayName().toString();
                } catch (Exception ignored) { }
                sim.put("name", name);
                try {
                    sim.put("enabled", phoneApi.getMethod("isCrossSimCallingEnabledByUser", int.class).invoke(phone, id));
                } catch (Exception e) {
                    sim.put("error", "无法读取开关，等待 SIM / IMS 就绪");
                }
                sims.put(sim);
            }
            int[] after = (int[]) subApi.getMethod("getActiveSubIdList", boolean.class).invoke(subs, false);
            Arrays.sort(ids); Arrays.sort(after);
            if (!Arrays.equals(ids, after)) throw new IllegalStateException("SIM 正在切换，请稍后刷新");
            for (int i = 0; i < sims.length(); i++) {
                JSONObject sim = sims.getJSONObject(i);
                RootBridge.requireActive(subs, subApi, sim.getInt("id"), sim.getInt("slot"));
            }
            if (dataId != (Integer) subApi.getMethod("getDefaultDataSubId").invoke(subs))
                throw new IllegalStateException("默认数据卡正在切换，请稍后刷新");
            if (summary) {
                System.out.println(formatSummary(sims, english));
                return;
            }
            if (args[0].equals("toggle-secondary")) {
                // Explicit CLI command only; the manager's Action button reads a summary.
                JSONObject target = null;
                boolean dataPresent = false;
                for (int i = 0; i < sims.length(); i++) {
                    JSONObject sim = sims.getJSONObject(i);
                    if (sim.getBoolean("data")) { dataPresent = true; continue; }
                    if (target != null) throw new IllegalStateException("存在多个副卡，拒绝自动选择。请使用 WebUI 明确选卡。");
                    target = sim;
                }
                if (!dataPresent || target == null || !target.has("enabled"))
                    throw new IllegalStateException("需要一张默认数据卡和一张可用副卡，未修改设置。");
                if (dataId != (Integer) subApi.getMethod("getDefaultDataSubId").invoke(subs))
                    throw new IllegalStateException("默认数据卡已改变，未修改设置。");
                System.out.println("目标：卡 " + (target.getInt("slot") + 1) + " · " + target.getString("name")
                        + "，订阅 ID " + target.getInt("id"));
                boolean enabled = target.getBoolean("enabled");
                System.out.println("跨卡通话：" + (enabled ? "已开启 → 关闭" : "已关闭 → 开启"));
                RootBridge.main(new String[]{enabled ? "off" : "on", Integer.toString(target.getInt("id")),
                        Integer.toString(target.getInt("slot"))});
                return;
            }
            System.out.println("CROSSSIM_RESULT:" + new JSONObject().put("ok", true).put("uid", Process.myUid())
                    .put("dataSubId", dataId).put("sims", sims));
            System.exit(0);
        } catch (Throwable e) {
            while (e instanceof InvocationTargetException && e.getCause() != null) e = e.getCause();
            if (summary) {
                System.out.println(english ? "Status unavailable. Try again shortly." : "状态暂不可用，请稍后重试。");
            } else try {
                System.out.println("CROSSSIM_RESULT:" + new JSONObject().put("ok", false).put("uid", Process.myUid())
                        .put("error", e.getClass().getSimpleName() + ": " + e.getMessage()));
            } catch (Exception ignored) { }
            System.exit(1);
        }
    }

    static String formatSummary(JSONArray sims, boolean english) throws Exception {
        if (sims.length() == 0) return english ? "No active SIMs" : "暂无已启用的 SIM";
        JSONObject[] ordered = new JSONObject[sims.length()];
        for (int i = 0; i < sims.length(); i++) ordered[i] = sims.getJSONObject(i);
        Arrays.sort(ordered, new Comparator<JSONObject>() {
            @Override public int compare(JSONObject a, JSONObject b) {
                return Integer.compare(a.optInt("slot"), b.optInt("slot"));
            }
        });
        StringBuilder text = new StringBuilder();
        for (JSONObject sim : ordered) {
            if (text.length() > 0) text.append("\n\n");
            String slot = "SIM " + (sim.getInt("slot") + 1);
            // Keep system-provided names on one plain terminal line.
            String name = sim.optString("name", "").replaceAll("[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]", " ").trim();
            text.append(slot);
            if (!name.isEmpty() && !name.equals(slot)) text.append(" · ").append(name);
            if (sim.getBoolean("data")) text.append(english ? " · Data SIM" : " · 数据卡");
            text.append(english ? "\nCross-SIM switch: " : "\n跨卡通话开关：");
            if (!sim.has("enabled")) text.append(english ? "Unavailable" : "暂不可用");
            else if (sim.getBoolean("enabled")) text.append(english ? "On" : "已开启");
            else text.append(english ? "Off" : "已关闭");
        }
        return text.toString();
    }
}
