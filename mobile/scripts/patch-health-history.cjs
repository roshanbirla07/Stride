// The installed health-connect bridge omits history access from permission results.
// Keep this patch explicit and fail on upstream changes rather than patching blindly.
const fs = require('node:fs');
const path = require('node:path');
const root = path.dirname(require.resolve('react-native-health-connect/package.json'));
const target = path.join(root, 'android/src/main/java/dev/matinzd/healthconnect/permissions/PermissionUtils.kt');
const source = fs.readFileSync(target, 'utf8');
const marker = '// Stride: expose granted history permission';
if (!source.includes(marker)) {
  const anchor = '        // Handle special permissions';
  if (!source.includes(anchor)) throw new Error('Health Connect permission bridge changed; review the history patch');
  const addition = `${anchor}
        ${marker}
        if (grantedPermissions.contains(HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY)) {
          pushMap(ReactPermission(AccessType.READ, "ReadHealthDataHistory").toReadableMap())
        }`;
  fs.writeFileSync(target, source.replace(anchor, addition));
}
