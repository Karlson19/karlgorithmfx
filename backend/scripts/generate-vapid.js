// Generate a VAPID key pair for Web Push.
//
// Run locally (NOT committed anywhere):
//   cd backend && npm install && node scripts/generate-vapid.js
//
// Then add to env:
//   Backend (Render):
//     VAPID_PUBLIC_KEY  = <publicKey>
//     VAPID_PRIVATE_KEY = <privateKey>          (SECRET — backend only)
//     VAPID_SUBJECT     = mailto:you@example.com
//   Frontend (Vercel):
//     NEXT_PUBLIC_VAPID_PUBLIC_KEY = <publicKey>   (same public key)
//
// The private key authenticates push messages — treat it like a password.
// If it leaks, regenerate and update env everywhere.

const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();

console.log('\n─── VAPID keys generated ───────────────────────────────────\n');
console.log('Backend (Render) env vars:');
console.log('  VAPID_PUBLIC_KEY  =', keys.publicKey);
console.log('  VAPID_PRIVATE_KEY =', keys.privateKey);
console.log('  VAPID_SUBJECT     = mailto:you@example.com   (change to your email)');
console.log('\nFrontend (Vercel) env var:');
console.log('  NEXT_PUBLIC_VAPID_PUBLIC_KEY =', keys.publicKey);
console.log('\nKeep the PRIVATE key secret. Public key is safe to expose.\n');
