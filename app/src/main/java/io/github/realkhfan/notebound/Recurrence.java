package io.github.realkhfan.notebound;

import java.util.Calendar;

/**
 * Repeating reminders. Mirrors web/src/store/recurrence.js so the app and the
 * alarm scheduler always agree. Occurrences are computed from the original
 * time (never cumulatively): a reminder on the 31st stays on the 31st in long
 * months and moves to the last day in shorter ones.
 */
public final class Recurrence {
    private Recurrence() {}

    static int floorDiv(int a, int b) {
        int q = a / b;
        if ((a % b != 0) && ((a < 0) != (b < 0))) q--;
        return q;
    }

    static int daysInMonth(int year, int month) {
        Calendar c = Calendar.getInstance();
        c.clear();
        c.set(year, month, 1);
        return c.getActualMaximum(Calendar.DAY_OF_MONTH);
    }

    static long occurrence(long baseMs, String repeat, int k) {
        Calendar b = Calendar.getInstance();
        b.setTimeInMillis(baseMs);
        int y = b.get(Calendar.YEAR);
        int m = b.get(Calendar.MONTH);
        int d = b.get(Calendar.DAY_OF_MONTH);
        int hh = b.get(Calendar.HOUR_OF_DAY);
        int mm = b.get(Calendar.MINUTE);
        int ss = b.get(Calendar.SECOND);
        Calendar c = Calendar.getInstance();
        c.clear();
        c.setLenient(true);
        switch (repeat) {
            case "daily":
                c.set(y, m, d + k, hh, mm, ss);
                break;
            case "weekly":
                c.set(y, m, d + 7 * k, hh, mm, ss);
                break;
            case "monthly": {
                int tm = m + k;
                int ty = y + floorDiv(tm, 12);
                int tmm = tm - floorDiv(tm, 12) * 12;
                c.set(ty, tmm, Math.min(d, daysInMonth(ty, tmm)), hh, mm, ss);
                break;
            }
            case "yearly": {
                int ty = y + k;
                c.set(ty, m, Math.min(d, daysInMonth(ty, m)), hh, mm, ss);
                break;
            }
            default:
                return baseMs;
        }
        return c.getTimeInMillis();
    }

    /** Next time strictly after {@code afterMs}, or -1 when a one-time reminder is in the past. */
    public static long next(long baseMs, String repeat, long afterMs) {
        if (baseMs > afterMs) return baseMs;
        if (repeat == null || repeat.isEmpty() || "none".equals(repeat)) return -1;
        long diff = afterMs - baseMs;
        int k;
        switch (repeat) {
            case "daily":
                k = (int) (diff / 86400000L) - 1;
                break;
            case "weekly":
                k = (int) (diff / 604800000L) - 1;
                break;
            case "monthly": {
                Calendar a = Calendar.getInstance();
                a.setTimeInMillis(afterMs);
                Calendar b = Calendar.getInstance();
                b.setTimeInMillis(baseMs);
                k = (a.get(Calendar.YEAR) - b.get(Calendar.YEAR)) * 12 + (a.get(Calendar.MONTH) - b.get(Calendar.MONTH)) - 1;
                break;
            }
            case "yearly": {
                Calendar a = Calendar.getInstance();
                a.setTimeInMillis(afterMs);
                Calendar b = Calendar.getInstance();
                b.setTimeInMillis(baseMs);
                k = a.get(Calendar.YEAR) - b.get(Calendar.YEAR) - 1;
                break;
            }
            default:
                return -1;
        }
        if (k < 1) k = 1;
        for (int i = 0; i < 1000; i++, k++) {
            long c = occurrence(baseMs, repeat, k);
            if (c > afterMs) return c;
        }
        return -1;
    }
}
