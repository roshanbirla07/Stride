import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, Pressable, SafeAreaView, ScrollView, Share, StatusBar, StyleSheet, Text, TextInput, View} from 'react-native';
import {authorize, readSteps, source} from './health';
import {board, credentials, getApiUrl, setApiUrl, logout, savedUser, refreshTotal, healthConnected, rememberHealth, Board, groups as listGroups, createGroup, joinGroup, rotateGroupCode, Group} from './api';

type Period = 'day'|'week'|'month';
const pad=(n:number)=>String(n).padStart(2,'0');
function istNow(){return new Date(Date.now()+330*60*1000)}
function dayString(offset=0){const d=istNow();d.setUTCDate(d.getUTCDate()+offset);return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`}
function range(day:string) {
  const [y,m,d]=day.split('-').map(Number);
  const start=new Date(Date.UTC(y,m-1,d)-330*60*1000);
  return [start,new Date(start.getTime()+86400000)] as const;
}
function initials(name:string){return name.trim().split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase()}
function healthDay(timestamp:string){
  const date=new Date(timestamp);
  if(Number.isNaN(date.getTime()))return '';
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
function dateLabel(day:string){return range(day)[0].toLocaleDateString('en-GB',{timeZone:'Asia/Kolkata',day:'numeric',month:'short'})}
function freshness(timestamp:string){
  const day=healthDay(timestamp);
  if(!day)return 'Refresh time unavailable';
  const time=new Date(timestamp).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'});
  return `Updated ${day===dayString()?'today':dateLabel(day)} · ${time} IST`;
}
function periodStart(period:Period){
  const date=istNow();
  if(period==='week')date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
  if(period==='month')date.setUTCDate(1);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}`;
}
const C={bg:'#101726',panel:'#1d2737',text:'#f5f6fc',muted:'#8997af',line:'#324054',lime:'#baff57',purple:'#6f45ff',older:'#ffcf95'};

export default function App(){
  const [user,setUser]=useState<{id:number;name:string;email:string}|null>(null);
  const [mode,setMode]=useState<'login'|'register'>('register');
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState('');
  const [apiUrl,setApiUrlInput]=useState('');
  const [period,setPeriod]=useState<Period>('day');
  const [data,setData]=useState<Board|null>(null);
  const [groupList,setGroupList]=useState<Group[]>([]);
  const [groupId,setGroupId]=useState<number|null>(null);
  const [manageGroups,setManageGroups]=useState(false);
  const [groupName,setGroupName]=useState(''),[joinCode,setJoinCode]=useState('');
  const [groupMessage,setGroupMessage]=useState('');
  const [message,setMessage]=useState('Connect your steps to join the leaderboard');
  const [busy,setBusy]=useState(false);
  const [connected,setConnected]=useState(false);
  const [refreshing,setRefreshing]=useState(false);
  const [refreshError,setRefreshError]=useState('');
  const requestId=useRef(0);
  const refresh=useCallback(async()=>{
    const id=++requestId.current;
    if(!user || !groupId){setData(null);setRefreshing(false);return;}
    setRefreshing(true);setRefreshError('');
    try{
      const day=dayString();
      let result=await board(period,day,groupId);
      if(connected){
        const group=groupList.find(g=>g.id===groupId);
        const from=group && group.effectiveDay>result.from?group.effectiveDay:result.from;
        if(from<=day){
          const [start]=range(from);
          const end=new Date();
          const steps=await readSteps(start,end);
          if(id!==requestId.current)return;
          result=await refreshTotal(period,day,from,groupId,steps,source,end.toISOString());
          if(id===requestId.current)setMessage(`Updated from health · ${end.toLocaleTimeString()}`);
        }
      }
      if(id===requestId.current)setData(result);
    }catch(e){if(id===requestId.current){const error=e instanceof Error?e.message:'Refresh failed. Try again.';setRefreshError(error);setMessage(error);}}
    finally{if(id===requestId.current)setRefreshing(false);}
  },[user,period,groupId,groupList,connected]);
  useEffect(()=>{getApiUrl().then(setApiUrlInput).then(()=>savedUser().then(setUser)).catch(()=>{});},[]);
  useEffect(()=>{
    let active=true;
    setConnected(false);
    if(user)healthConnected(user.id).then(value=>{if(active)setConnected(value);}).catch(e=>setMessage(e.message));
    return()=>{active=false;};
  },[user]);
  useEffect(()=>{
    setData(null);
    void refresh();
    return()=>{++requestId.current;};
  },[refresh]);
  useEffect(()=>{
    if(!user){setGroupList([]);setGroupId(null);return;}
    listGroups().then(result=>{
      setGroupList(result.groups);
      setGroupId(current=>result.groups.some(g=>g.id===current)?current:(result.groups[0]?.id??null));
      if(!result.groups.length)setManageGroups(true);
    }).catch(e=>setGroupMessage(e.message));
  },[user]);

  async function updateGroups(preferred?:number){
    const result=await listGroups();setGroupList(result.groups);
    setGroupId(result.groups.some(g=>g.id===preferred)?preferred!:(result.groups[0]?.id??null));
  }
  async function addGroup(){
    try{setBusy(true);const created=await createGroup(groupName.trim());setGroupName('');await updateGroups(created.id);setGroupMessage(`Created ${created.name}. Results start ${created.effectiveDay}.`);}
    catch(e){setGroupMessage(e instanceof Error?e.message:'Could not create group');}
    finally{setBusy(false);}
  }
  async function enterGroup(){
    try{setBusy(true);const before=new Set(groupList.map(g=>g.id));const result=await joinGroup(joinCode.trim());
      const joined=result.groups.find(g=>!before.has(g.id));setJoinCode('');await updateGroups(joined?.id);
      setGroupMessage(`Joined ${joined?.name||'group'}. Results start tomorrow.`);}
    catch(e){setGroupMessage(e instanceof Error?e.message:'Could not join group');}
    finally{setBusy(false);}
  }
  const selectedGroup=groupList.find(g=>g.id===groupId);

  async function sync(){
    if(!user || busy || refreshing)return;
    setBusy(true);
    try{
      await authorize();
      await rememberHealth(user.id);
      if(connected)await refresh();
      else setConnected(true);
    }catch(e){const error=e instanceof Error?e.message:'Could not connect health';setMessage(error);setRefreshError(error);}
    finally{setBusy(false);}
  }
  useEffect(()=>{
    const sub=AppState.addEventListener('change',state=>{if(state==='active')void refresh();});
    return()=>sub.remove();
  },[refresh]);

  async function signIn(){
    setBusy(true);
    try{await setApiUrl(apiUrl);setUser(await credentials(name,email,password,mode));setMessage('Connect your steps to join the leaderboard');}
    catch(e){setMessage(e instanceof Error?e.message:'Sign in failed');}
    finally{setBusy(false);}
  }
  const mine=data?.entries.find(x=>x.id===user?.id);
  const start=data?.from||periodStart(period),through=data?.through||dayString();
  const pending=selectedGroup && selectedGroup.effectiveDay>dayString();
  const hasCurrentTotal=mine && healthDay(mine.lastSync)===dayString();
  return <SafeAreaView style={s.safe}><StatusBar barStyle="light-content"/><ScrollView contentContainerStyle={s.content}>
    <View style={s.brandRow}><Text style={s.brand}>STRIDE <Text style={s.brandAccent}>●</Text></Text>{user&&<View style={s.avatar}><Text style={s.avatarText}>{initials(user.name)}</Text></View>}</View>
    {!user?<View style={s.auth}>
      <Text style={s.title}>Make every step count.</Text><Text style={s.muted}>The private challenge for your crew.</Text>
      <TextInput style={s.input} placeholder="Backend HTTPS URL" placeholderTextColor={C.muted} autoCapitalize="none" keyboardType="url" value={apiUrl} onChangeText={setApiUrlInput}/>
      {mode==='register'&&<TextInput style={s.input} placeholder="Display name" placeholderTextColor={C.muted} value={name} onChangeText={setName}/>}
      <TextInput style={s.input} placeholder="Email" placeholderTextColor={C.muted} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail}/>
      <TextInput style={s.input} placeholder="Password (10+ characters)" placeholderTextColor={C.muted} secureTextEntry value={password} onChangeText={setPassword}/>
      <Pressable style={s.primary} onPress={signIn} disabled={busy}><Text style={s.primaryText}>{busy?'Please wait…':mode==='register'?'Create account':'Sign in'}</Text></Pressable>
      <Pressable onPress={()=>setMode(mode==='login'?'register':'login')}><Text style={s.link}>{mode==='login'?'Create an account':'Already have an account? Sign in'}</Text></Pressable>
      <Text style={s.notice}>{message}</Text>
    </View>:<>
      <Text style={s.greeting}>{`Keep moving, ${user.name.split(' ')[0]}.`}</Text>
      <View style={s.groupPanel}><View style={s.groupHeader}><Text style={s.overline}>YOUR GROUPS</Text><Pressable onPress={()=>setManageGroups(!manageGroups)}><Text style={s.linkInline}>{manageGroups?'Done':'Manage'}</Text></Pressable></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>{groupList.map(g=><Pressable key={g.id} onPress={()=>setGroupId(g.id)} style={[s.groupChip,groupId===g.id&&s.groupChipActive]}><Text style={[s.groupChipText,groupId===g.id&&s.groupChipTextActive]}>{g.name}</Text></Pressable>)}</ScrollView>
        {!groupList.length&&<Text style={s.muted}>Create a group or join your friends with their code.</Text>}
        {selectedGroup&&selectedGroup.effectiveDay>dayString()&&<Text style={s.muted}>Your results here begin {selectedGroup.effectiveDay}. Keep syncing.</Text>}
        {manageGroups&&<View><Text style={s.note}>Previous rewards · paused: {data?.wallet.coins||0} coins · {data?.wallet.points||0} points</Text><Text style={s.muted}>Invite code: {selectedGroup?.code||'Select a group'}</Text>
          {!!selectedGroup&&<Pressable onPress={()=>Share.share({message:`Join my Stride group ${selectedGroup.name} with code ${selectedGroup.code}`})}><Text style={s.linkInline}>Share code</Text></Pressable>}
          {selectedGroup?.ownerId===user.id&&<Pressable onPress={async()=>{try{await rotateGroupCode(selectedGroup.id);await updateGroups(selectedGroup.id);setGroupMessage('Code regenerated. Share the new code.');}catch(e){setGroupMessage(e instanceof Error?e.message:'Could not rotate code');}}}><Text style={s.linkInline}>Regenerate code</Text></Pressable>}
          <TextInput style={s.input} placeholder="New group name" placeholderTextColor={C.muted} value={groupName} onChangeText={setGroupName}/>
          <Pressable style={s.secondary} onPress={addGroup} disabled={busy}><Text style={s.secondaryText}>Create group</Text></Pressable>
          <TextInput style={s.input} placeholder="8-character invite code" placeholderTextColor={C.muted} autoCapitalize="characters" value={joinCode} onChangeText={setJoinCode}/>
          <Pressable style={s.secondary} onPress={enterGroup} disabled={busy}><Text style={s.secondaryText}>Join group</Text></Pressable>
          {!!groupMessage&&<Text style={s.notice}>{groupMessage}</Text>}
        </View>}
      </View>
      <View style={s.tabs}>{(['day','week','month'] as Period[]).map(p=><Pressable key={p} accessibilityRole="button" accessibilityState={{selected:period===p}} onPress={()=>setPeriod(p)} style={[s.tab,period===p&&s.selected]}><Text style={[s.tabText,period===p&&s.selectedText]}>{p==='day'?'Today':p==='week'?'Week':'Month'}</Text></Pressable>)}</View>
      <Text style={s.periodRange}>{dateLabel(start)}{start.slice(0,4)!==through.slice(0,4)?` ${start.slice(0,4)}`:''}{start!==through?` – ${dateLabel(through)}`:''} {through.slice(0,4)} · IST</Text>
      <View style={s.hero} accessibilityState={{busy:refreshing}}><Text style={s.heroLabel}>YOUR STEPS {period==='day'?'TODAY':`THIS ${period.toUpperCase()}`}</Text><Text style={s.heroNumber}>{refreshing?'…':mine?mine.steps.toLocaleString():'—'}</Text><Text style={s.heroSub}>{refreshing?'Updating your rank…':mine?`Rank #${mine.rank} of ${data?.entries.length}`:pending?`Results begin ${dateLabel(selectedGroup!.effectiveDay)}`:groupId?'Refresh your health steps to appear':'Create or join your crew'}</Text><Text style={s.arrow} accessible={false}>↗</Text></View>
      <View style={s.healthPanel}><View style={s.healthDetails}><Text style={s.healthTitle}>{source==='healthkit'?'Apple Health':'Health Connect'}</Text><Text style={[s.healthStatus,refreshError?{color:C.older}:null]} accessibilityLiveRegion="polite">{refreshing?'Refreshing steps…':refreshError?'Refresh failed':mine?freshness(mine.lastSync):connected?'No total for this period':'Connect to read your steps'}</Text></View><Text accessible={false} style={[s.healthBadge,hasCurrentTotal&&!refreshError&&!refreshing?s.healthBadgeFresh:null]}>{refreshing?'↻':refreshError?'!':hasCurrentTotal?'✓':'—'}</Text></View>
      {!!refreshError&&<Text style={s.error} accessibilityLiveRegion="polite">{refreshError}. Tap Refresh steps to retry.</Text>}
      <Pressable style={s.primary} accessibilityRole="button" accessibilityState={{disabled:busy||refreshing,busy:busy||refreshing}} onPress={sync} disabled={busy||refreshing}><Text style={s.primaryText}>{busy||refreshing?'Refreshing…':connected?'↻  Refresh steps':'Connect health & refresh steps'}</Text></Pressable>
      <View style={s.headline}><Text style={s.section}>Leaderboard</Text></View><Text style={s.listCaption}>Latest totals from your crew</Text>
      {refreshing?<Text style={s.empty}>Loading standings…</Text>:data?.entries.length?data.entries.map(entry=><View key={entry.id} style={[s.row,entry.id===user.id&&s.myRow]}><Text style={s.rank}>#{entry.rank}</Text><View style={[s.smallAvatar,entry.id===user.id?s.myAvatar:null]}><Text style={s.smallAvatarText}>{initials(entry.name)}</Text></View><View style={s.personDetails}><Text style={s.personName}>{entry.id===user.id?'You':entry.name}</Text><Text style={[s.entryTime,healthDay(entry.lastSync)<dayString()?{color:C.older}:null]}>{freshness(entry.lastSync)}</Text></View><View style={s.stepDetails}><Text style={s.count}>{entry.steps.toLocaleString()}</Text><Text style={s.unit}>steps</Text></View></View>):<Text style={s.empty}>{refreshError?'Standings unavailable. Retry the refresh.':pending?`Your membership starts ${dateLabel(selectedGroup!.effectiveDay)}. Check back then.`:groupId?'No totals yet. Refresh health steps to appear here.':'Create a group or join your friends to see standings.'}</Text>}
      <Text style={s.note}>Rankings use each member’s latest refresh. Day ends at 00:00 IST.</Text>
      <Pressable onPress={async()=>{await logout();setUser(null);setData(null);setConnected(false);}}><Text style={s.signOut}>Sign out</Text></Pressable>
    </>}
  </ScrollView></SafeAreaView>
}
const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:C.bg},content:{padding:23,paddingBottom:50},brand:{color:C.text,fontSize:14,fontWeight:'900',letterSpacing:4},brandAccent:{color:C.lime},
  auth:{paddingTop:50},title:{color:C.text,fontSize:31,fontWeight:'900',letterSpacing:-1.2,lineHeight:36},muted:{color:C.muted,fontSize:14,marginTop:12},input:{backgroundColor:C.panel,color:C.text,borderRadius:12,padding:16,marginTop:14,borderWidth:1,borderColor:C.line},
  primary:{backgroundColor:C.lime,borderRadius:12,padding:15,alignItems:'center',marginTop:16},primaryText:{color:'#192417',fontWeight:'900',fontSize:14},link:{color:C.lime,textAlign:'center',marginTop:18},notice:{color:C.muted,marginTop:18,lineHeight:20},
  overline:{color:C.muted,fontSize:10,letterSpacing:2,fontWeight:'800',marginBottom:8},avatar:{backgroundColor:C.lime,width:42,height:42,borderRadius:22,alignItems:'center',justifyContent:'center'},avatarText:{fontWeight:'900',color:'#192417'},
  tabs:{flexDirection:'row',backgroundColor:C.panel,borderRadius:14,padding:4,marginTop:22,marginBottom:10},tab:{flex:1,alignItems:'center',padding:10,borderRadius:10},selected:{backgroundColor:C.lime},tabText:{color:C.muted,fontWeight:'800'},selectedText:{color:'#192417'},
  hero:{backgroundColor:C.purple,borderRadius:20,padding:20,minHeight:156,overflow:'hidden'},heroLabel:{color:'#ded2ff',fontWeight:'800',fontSize:11,letterSpacing:1},heroNumber:{color:'white',fontWeight:'900',fontSize:50,letterSpacing:-2,marginTop:4},heroSub:{color:'#e7ddff',fontSize:12},arrow:{position:'absolute',right:16,top:12,color:'#a1ff70',fontSize:44,fontWeight:'200',opacity:.8},
  headline:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:28,marginBottom:10},section:{color:C.text,fontWeight:'900',fontSize:19},
  row:{flexDirection:'row',alignItems:'center',backgroundColor:C.panel,borderRadius:13,padding:12,marginBottom:8,borderWidth:1,borderColor:C.line},myRow:{borderColor:C.lime},rank:{color:C.muted,width:30,fontWeight:'800'},smallAvatar:{width:32,height:32,borderRadius:16,backgroundColor:'#38475d',alignItems:'center',justifyContent:'center'},smallAvatarText:{color:C.text,fontSize:10,fontWeight:'800'},personDetails:{flex:1,marginLeft:10},personName:{color:C.text,fontWeight:'800',lineHeight:20},count:{color:C.text,fontWeight:'900'},unit:{fontSize:11,fontWeight:'400',color:C.muted,marginTop:3},
  note:{color:C.muted,fontSize:11,lineHeight:17,marginTop:16},signOut:{color:C.muted,textAlign:'center',marginTop:28}
  ,brandRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:22},greeting:{color:C.text,fontSize:28,fontWeight:'800',lineHeight:35},periodRange:{color:C.muted,fontSize:13,lineHeight:20,marginBottom:12},healthPanel:{backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:14,padding:16,marginTop:14,flexDirection:'row',alignItems:'center',gap:12},healthDetails:{flex:1},healthTitle:{color:C.text,fontSize:15,fontWeight:'800'},healthStatus:{color:C.muted,fontSize:12,lineHeight:18,marginTop:4},healthBadge:{color:C.muted,backgroundColor:C.line,width:30,height:30,borderRadius:15,textAlign:'center',lineHeight:30,fontWeight:'800'},healthBadgeFresh:{backgroundColor:C.lime,color:'#192417'},error:{color:C.older,fontSize:13,lineHeight:20,marginTop:10},listCaption:{color:C.muted,fontSize:13,marginBottom:14},entryTime:{color:C.muted,fontSize:11,lineHeight:16,marginTop:4},stepDetails:{alignItems:'flex-end'},myAvatar:{backgroundColor:C.purple},empty:{color:C.muted,fontSize:14,lineHeight:22,paddingVertical:20},groupPanel:{backgroundColor:C.panel,borderRadius:14,padding:14,marginTop:20,borderWidth:1,borderColor:C.line},groupHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},groupChip:{borderWidth:1,borderColor:C.line,borderRadius:20,paddingHorizontal:15,paddingVertical:9,marginRight:8,marginTop:10},groupChipActive:{backgroundColor:C.lime,borderColor:C.lime},groupChipText:{color:C.text,fontWeight:'800'},groupChipTextActive:{color:'#192417'},linkInline:{color:C.lime,fontWeight:'800',paddingVertical:8},secondary:{backgroundColor:'#35465d',borderRadius:10,padding:12,alignItems:'center',marginTop:8},secondaryText:{color:C.text,fontWeight:'800'}
});
