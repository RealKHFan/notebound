import io.github.realkhfan.notebound.Recurrence;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.text.SimpleDateFormat;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Runs web/tests/fixtures/recurrence-cases.json against Recurrence.java (no Android or JUnit needed). */
public class RecurrenceCheck {
    public static void main(String[] args) throws Exception {
        String json = new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8);
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm");
        Matcher m = Pattern.compile("\\{\\s*\"note\":\\s*\"([^\"]*)\",\\s*\"base\":\\s*\"([^\"]*)\",\\s*\"repeat\":\\s*\"([^\"]*)\",\\s*\"after\":\\s*\"([^\"]*)\",\\s*\"expect\":\\s*(null|\"[^\"]*\")\\s*\\}").matcher(json);
        int n = 0, failed = 0;
        while (m.find()) {
            n++;
            long base = f.parse(m.group(2)).getTime();
            long after = f.parse(m.group(4)).getTime();
            long got = Recurrence.next(base, m.group(3), after);
            String expect = m.group(5).equals("null") ? null : m.group(5).replace("\"", "");
            String gotS = got < 0 ? null : f.format(new java.util.Date(got));
            boolean ok = expect == null ? gotS == null : expect.equals(gotS);
            System.out.println((ok ? "ok   " : "FAIL ") + m.group(1) + " -> " + gotS);
            if (!ok) failed++;
        }
        System.out.println(n + " cases, " + failed + " failed");
        if (failed > 0 || n == 0) System.exit(1);
    }
}
