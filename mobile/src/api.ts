import * as SecureStore from 'expo-secure-store';

let base = process.env.EXPO_PUBLIC_API_URL || '';
export async function setApiUrl(url:string) {
  const normalized = url.trim().replace(/\/+$/, '');
  if (!normalized.startsWith('https://') && !normalized.startsWith('http://localhost'))
    throw new Error('Use a reachable HTTPS URL');
  base = normalized;
  await SecureStore.setItemAsync('stride_api_url', base);
}
export async function getApiUrl() {
  const saved = await SecureStore.getItemAsync('stride_api_url');
  if (saved) base = saved;
  return base;
}
export type Entry = {id:number; name:string; rank:number; steps:number; lastSync:string};
export type Board = {entries:Entry[]; wallet:{points:number; coins:number}; settled:boolean; from:string; through:string};

async function request(path:string, method='GET', body?:object, token?:string) {
  if (!base.startsWith('https://') && !base.startsWith('http://localhost'))
    throw new Error('Set EXPO_PUBLIC_API_URL to the backend HTTPS URL');
  const res = await fetch(base+path, {
    method,
    headers: {'Content-Type':'application/json', ...(token ? {Authorization:'Bearer '+token} : {})},
    ...(body ? {body:JSON.stringify(body)} : {})
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
export async function credentials(name:string, email:string, password:string, mode:'login'|'register') {
  const data = await request('/auth/'+mode, 'POST', {name,email,password});
  await SecureStore.setItemAsync('stride_token', data.token);
  await SecureStore.setItemAsync('stride_user', JSON.stringify(data.user));
  return data.user;
}
export async function savedUser() {
  const raw = await SecureStore.getItemAsync('stride_user');
  return raw ? JSON.parse(raw) as {id:number;name:string;email:string} : null;
}
export async function logout() {
  await SecureStore.deleteItemAsync('stride_token');
  await SecureStore.deleteItemAsync('stride_user');
}
async function withToken(path:string, method='GET', body?:object) {
  const token = await SecureStore.getItemAsync('stride_token');
  if (!token) throw new Error('Sign in required');
  return request(path,method,body,token);
}
export async function board(period:'day'|'week'|'month', day:string):Promise<Board> {
  return withToken('/leaderboard?period='+period+'&day='+day);
}
export async function upload(day:string, steps:number, source:string) {
  return withToken('/steps','POST',{day,steps,source});
}
