/**
 * Credential migration script — supports two modes:
 *
 * 1. Initial encryption: Encrypt plaintext credentials for the first time.
 *    CREDENTIAL_ENCRYPTION_KEY=<new-key> npx tsx scripts/migrate-credentials.ts
 *
 * 2. Key rotation: Re-encrypt credentials from old key to new key.
 *    CREDENTIAL_ENCRYPTION_KEY=<new-key> \
 *    CREDENTIAL_ENCRYPTION_KEY_PREVIOUS=<old-key> \
 *    npx tsx scripts/migrate-credentials.ts --rotate
 *
 * Safe to re-run — already-encrypted rows (with current key) are skipped.
 */
import 'dotenv/config';
import { getDb, closeDb } from '../src/config/database.js';
import { billingConnections } from '../src/models/schema.js';
import { writeCredentials, readCredentials } from '../src/security/credentials.js';
import { isEncrypted } from '../src/security/encryption.js';
import { eq } from 'drizzle-orm';

const isRotation = process.argv.includes('--rotate');

async function main() {
  if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
    console.error('ERROR: CREDENTIAL_ENCRYPTION_KEY env var is required.');
    console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }

  if (isRotation && !process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS) {
    console.error('ERROR: --rotate requires CREDENTIAL_ENCRYPTION_KEY_PREVIOUS (the old key).');
    process.exit(1);
  }

  const mode = isRotation ? 'KEY ROTATION' : 'INITIAL ENCRYPTION';
  console.log(`Mode: ${mode}\n`);

  const db = getDb();

  const connections = await db.select().from(billingConnections);
  console.log(`Found ${connections.length} billing connections`);

  let encrypted = 0;
  let skipped = 0;
  let errors = 0;

  for (const conn of connections) {
    const raw = conn.credentials;

    // Skip if already encrypted and not doing rotation
    if (!isRotation && typeof raw === 'string' && isEncrypted(raw)) {
      console.log(`  [SKIP] ${conn.id} (${conn.source}) — already encrypted`);
      skipped++;
      continue;
    }

    // Skip plaintext rows in rotation mode (they need initial encryption, not rotation)
    if (isRotation && (typeof raw !== 'string' || !isEncrypted(raw))) {
      console.log(`  [SKIP] ${conn.id} (${conn.source}) — not encrypted (run without --rotate first)`);
      skipped++;
      continue;
    }

    try {
      // Read credentials (decrypt with current or previous key)
      const creds = readCredentials<Record<string, unknown>>(raw);
      // Re-encrypt with the current (new) key
      const encryptedValue = writeCredentials(creds);

      await db
        .update(billingConnections)
        .set({ credentials: encryptedValue, updatedAt: new Date() })
        .where(eq(billingConnections.id, conn.id));

      console.log(`  [OK]   ${conn.id} (${conn.source}) — ${isRotation ? 're-encrypted with new key' : 'encrypted'}`);
      encrypted++;
    } catch (err: any) {
      console.error(`  [ERR]  ${conn.id} (${conn.source}) — ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone: ${encrypted} ${isRotation ? 're-encrypted' : 'encrypted'}, ${skipped} skipped, ${errors} errors`);

  if (isRotation && errors === 0 && encrypted > 0) {
    console.log('\nAll credentials re-encrypted. You can now remove CREDENTIAL_ENCRYPTION_KEY_PREVIOUS from your environment.');
  }

  await closeDb();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
