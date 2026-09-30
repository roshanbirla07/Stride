import { aggregateRecord, initialize, requestPermission } from 'react-native-health-connect';

export const source = 'health_connect';
let ready = false;
export async function authorize() {
  if (!(await initialize())) throw new Error('Health Connect is unavailable on this phone');
  const granted = await requestPermission([{ accessType: 'read', recordType: 'Steps' }]);
  ready = granted.some(p => p.accessType === 'read' && p.recordType === 'Steps');
  if (!ready) throw new Error('Step access was not granted');
}
export async function readSteps(start: Date, end: Date) {
  if (!ready) await authorize();
  const result = await aggregateRecord({
    recordType: 'Steps',
    timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() }
  });
  return Math.round(result.COUNT_TOTAL ?? 0);
}
