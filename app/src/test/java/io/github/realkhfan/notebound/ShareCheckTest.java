package io.github.realkhfan.notebound;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Which files shared by other apps Notebound may copy into the notes folder. */
public class ShareCheckTest {
    private static final String OWN = "io.github.realkhfan.notebound.files";

    @Test
    public void picturesFromAnotherAppAreAccepted() {
        assertTrue(ShareProvider.acceptShared("content", "com.android.providers.media.documents", OWN));
    }

    @Test
    public void filePathsAreRefused() {
        // would let any app make Notebound copy its own private files
        assertFalse(ShareProvider.acceptShared("file", null, OWN));
        assertFalse(ShareProvider.acceptShared("file", "", OWN));
    }

    @Test
    public void noteboundsOwnFilesAreRefused() {
        assertFalse(ShareProvider.acceptShared("content", OWN, OWN));
    }

    @Test
    public void brokenAddressesAreRefused() {
        assertFalse(ShareProvider.acceptShared(null, "com.example", OWN));
        assertFalse(ShareProvider.acceptShared("content", null, OWN));
        assertFalse(ShareProvider.acceptShared("content", "", OWN));
    }
}
