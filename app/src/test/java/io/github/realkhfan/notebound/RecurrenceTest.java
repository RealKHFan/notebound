package io.github.realkhfan.notebound;

import static org.junit.Assert.assertEquals;

import java.text.SimpleDateFormat;
import java.util.TimeZone;
import org.junit.Test;

/** The same cases as web/tests/fixtures/recurrence-cases.json, for Gradle's unit tests. */
public class RecurrenceTest {
    private static final SimpleDateFormat F = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm");
    static {
        TimeZone.setDefault(TimeZone.getTimeZone("Europe/Berlin"));
        F.setTimeZone(TimeZone.getTimeZone("Europe/Berlin"));
    }

    private static String next(String base, String repeat, String after) throws Exception {
        long r = Recurrence.next(F.parse(base).getTime(), repeat, F.parse(after).getTime());
        return r < 0 ? null : F.format(new java.util.Date(r));
    }

    @Test public void monthlyClampsToLastDay() throws Exception { assertEquals("2026-02-28T09:00", next("2026-01-31T09:00", "monthly", "2026-02-01T00:00")); }
    @Test public void monthlyReturnsToThe31st() throws Exception { assertEquals("2026-03-31T09:00", next("2026-01-31T09:00", "monthly", "2026-03-01T00:00")); }
    @Test public void yearlyLeapDay() throws Exception {
        assertEquals("2025-02-28T08:00", next("2024-02-29T08:00", "yearly", "2025-01-01T00:00"));
        assertEquals("2028-02-29T08:00", next("2024-02-29T08:00", "yearly", "2028-01-01T00:00"));
    }
    @Test public void weekly() throws Exception { assertEquals("2026-10-19T18:00", next("2026-10-05T18:00", "weekly", "2026-10-18T12:00")); }
    @Test public void dailyOverClockChanges() throws Exception {
        assertEquals("2026-10-25T08:00", next("2026-10-24T08:00", "daily", "2026-10-24T10:00"));
        assertEquals("2026-03-29T09:15", next("2026-03-27T09:15", "daily", "2026-03-28T10:00"));
    }
    @Test public void oneTimeInThePast() throws Exception { assertEquals(null, next("2026-10-01T08:00", "none", "2026-10-18T12:00")); }
    @Test public void exactlyAtOccurrence() throws Exception { assertEquals("2026-10-19T08:00", next("2026-10-01T08:00", "daily", "2026-10-18T08:00")); }
}
