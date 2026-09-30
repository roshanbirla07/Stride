// TypeScript fallback. Metro selects health.android.ts or health.ios.ts.
export const source: string = '';
export async function authorize(): Promise<void> {
  throw new Error('Health data requires an Android or iOS native build');
}
export async function readSteps(_start: Date, _end: Date): Promise<number> {
  throw new Error('Health data requires an Android or iOS native build');
}
