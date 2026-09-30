import { isHealthDataAvailable, queryStatisticsForQuantity, requestAuthorization } from '@kingstinct/react-native-healthkit';

export const source = 'healthkit';
let ready = false;
export async function authorize() {
  if (!(await isHealthDataAvailable())) throw new Error('HealthKit is unavailable on this iPhone');
  await requestAuthorization({ toRead: ['HKQuantityTypeIdentifierStepCount'] });
  ready = true;
  // HealthKit deliberately does not reveal whether read permission was denied.
}
export async function readSteps(start: Date, end: Date) {
  if (!ready) await authorize();
  const result = await queryStatisticsForQuantity('HKQuantityTypeIdentifierStepCount', ['cumulativeSum'], {
    filter: { date: { startDate: start, endDate: end } },
    unit: 'count'
  });
  return Math.round(result.sumQuantity?.quantity ?? 0);
}
