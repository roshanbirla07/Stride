import { aggregateRecord, initialize, requestPermission, openHealthConnectDataManagement } from 'react-native-health-connect';

export const source = 'health_connect';
let ready = false;
let historyGranted = false;
export async function authorize() {
  if (!(await initialize())) throw new Error('Health Connect is unavailable on this phone');
  const granted = await requestPermission([{ accessType: 'read', recordType: 'Steps' },
    { accessType: 'read', recordType: 'ReadHealthDataHistory' }]);
  historyGranted = granted.some(p => p.accessType === 'read' && p.recordType === 'ReadHealthDataHistory');
  ready = granted.some(p => p.accessType === 'read' && p.recordType === 'Steps');
  if (!ready) throw new Error('Step access was not granted');
}
export async function readSteps(start: Date, end: Date) {
  if (!ready) await authorize();
  // Health Connect's default history window is 30 days before permission grant.
  // Require extended history for longer ranges rather than publishing a partial total.
  const defaultHistoryDays = 30;
  if (start.getTime() < Date.now() - defaultHistoryDays * 86400000) {
    if (!historyGranted)
      throw new Error('Enable Health Connect history access for the full month, then refresh');
  }
  const result = await aggregateRecord({
    recordType: 'Steps',
    timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() }
  });
  return Math.round(result.COUNT_TOTAL ?? 0);
}

export async function openHealthSettings() {
  openHealthConnectDataManagement();
}
