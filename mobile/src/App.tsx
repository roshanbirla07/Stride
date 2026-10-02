import React, {useCallback, useEffect, useState} from 'react';
import {AppState, Pressable, SafeAreaView, ScrollView, Share, StatusBar, StyleSheet, Text, TextInput, View} from 'react-native';
import {authorize, readSteps, source} from './health';
import {board, credentials, getApiUrl, setApiUrl, logout, savedUser, upload, Board, groups as listGroups, createGroup, joinGroup, rotateGroupCode, Group} from './api';

type Period = 'day'|'week'|'month';
const pad=(n:number)=>String(n).padStart(2,'0');
function istNow(){return new Date(Date.now()+330*60*1000)}
function dayString(offset=0){const d=istNow();d.setUTCDate(d.getUTCDate()+offset);return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`}
function range(day:string) {
  const [y,m,d]=day.split('-').map(Number);
  const start=new Date(Date.UTC(y,m-1,d)-330*60*1000);
  return [start,new Date(start.getTime()+86400000)] as const;
}
const C={bg:'#101726',panel:'#1d2737',text:'#f5f6fc',muted:'#8997af',line:'#324054',lime:'#baff57',purple:'#6f45ff'};

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
  const refresh=useCallback(async(p:Period=period)=>{
    if(user && groupId) setData(await board(p,dayString(),groupId));
    else setData(null);
  },[user,period,groupId]);
  useEffect(()=>{getApiUrl().then(setApiUrlInput).then(()=>savedUser().then(setUser)).catch(()=>{});},[]);
  useEffect(()=>{refresh().catch(e=>setMessage(e.message));},[refresh]);
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
    if(!user || busy)return;
    setBusy(true);
    try{
      await authorize();
      setConnected(true);
      const day=dayString();
      const [start,end]=range(day);
      const steps=await readSteps(start,new Date(Math.min(end.getTime(),Date.now())));
      await upload(day,steps,source);
      // Yesterday remains open for thirty minutes after midnight IST.
      const n=istNow();
      if(n.getUTCHours()===0 && n.getUTCMinutes()<30){
        const yesterday=dayString(-1),[s,e]=range(yesterday);
        await upload(yesterday,await readSteps(s,e),source);
      }
      setMessage(`Synced ${steps.toLocaleString()} steps · ${new Date().toLocaleTimeString()}`);
      await refresh();
    }catch(e){setMessage(e instanceof Error?e.message:'Sync failed');}
    finally{setBusy(false);}
  }
  useEffect(()=>{
    const sub=AppState.addEventListener('change',state=>{if(state==='active'&&user&&connected)sync();});
    return()=>sub.remove();
  },[user,connected,busy]);

  async function signIn(){
    setBusy(true);
    try{await setApiUrl(apiUrl);setUser(await credentials(name,email,password,mode));setMessage('Connect your steps to join the leaderboard');}
    catch(e){setMessage(e instanceof Error?e.message:'Sign in failed');}
    finally{setBusy(false);}
  }
  const mine=data?.entries.find(x=>x.id===user?.id);
  return <SafeAreaView style={s.safe}><StatusBar barStyle="light-content"/><ScrollView contentContainerStyle={s.content}>
    <Text style={s.brand}>STRIDE <Text style={s.brandAccent}>●</Text></Text>
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
      <View style={s.header}><View><Text style={s.overline}>TODAY · {dayString()}</Text><Text style={s.title}>Keep moving,\n{user.name.split(' ')[0]}.</Text></View><View style={s.avatar}><Text style={s.avatarText}>{user.name.slice(0,2).toUpperCase()}</Text></View></View>
      <View style={s.groupPanel}><View style={s.groupHeader}><Text style={s.overline}>YOUR GROUPS</Text><Pressable onPress={()=>setManageGroups(!manageGroups)}><Text style={s.linkInline}>{manageGroups?'Done':'Manage'}</Text></Pressable></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>{groupList.map(g=><Pressable key={g.id} onPress={()=>setGroupId(g.id)} style={[s.groupChip,groupId===g.id&&s.groupChipActive]}><Text style={[s.groupChipText,groupId===g.id&&s.groupChipTextActive]}>{g.name}</Text></Pressable>)}</ScrollView>
        {!groupList.length&&<Text style={s.muted}>Create a group or join your friends with their code.</Text>}
        {selectedGroup&&selectedGroup.effectiveDay>dayString()&&<Text style={s.muted}>Your results here begin {selectedGroup.effectiveDay}. Keep syncing.</Text>}
        {manageGroups&&<View><Text style={s.muted}>Invite code: {selectedGroup?.code||'Select a group'}</Text>
          {!!selectedGroup&&<Pressable onPress={()=>Share.share({message:`Join my Stride group ${selectedGroup.name} with code ${selectedGroup.code}`})}><Text style={s.linkInline}>Share code</Text></Pressable>}
          {selectedGroup?.ownerId===user.id&&<Pressable onPress={async()=>{try{await rotateGroupCode(selectedGroup.id);await updateGroups(selectedGroup.id);setGroupMessage('Code regenerated. Share the new code.');}catch(e){setGroupMessage(e instanceof Error?e.message:'Could not rotate code');}}}><Text style={s.linkInline}>Regenerate code</Text></Pressable>}
          <TextInput style={s.input} placeholder="New group name" placeholderTextColor={C.muted} value={groupName} onChangeText={setGroupName}/>
          <Pressable style={s.secondary} onPress={addGroup} disabled={busy}><Text style={s.secondaryText}>Create group</Text></Pressable>
          <TextInput style={s.input} placeholder="8-character invite code" placeholderTextColor={C.muted} autoCapitalize="characters" value={joinCode} onChangeText={setJoinCode}/>
          <Pressable style={s.secondary} onPress={enterGroup} disabled={busy}><Text style={s.secondaryText}>Join group</Text></Pressable>
          {!!groupMessage&&<Text style={s.notice}>{groupMessage}</Text>}
        </View>}
      </View>
      <View style={s.tabs}>{(['day','week','month'] as Period[]).map(p=><Pressable key={p} onPress={()=>setPeriod(p)} style={[s.tab,period===p&&s.selected]}><Text style={[s.tabText,period===p&&s.selectedText]}>{p==='day'?'Today':p==='week'?'Week':'Month'}</Text></Pressable>)}</View>
      <View style={s.hero}><Text style={s.heroLabel}>YOUR STEPS {period.toUpperCase()}</Text><Text style={s.heroNumber}>{(mine?.steps||0).toLocaleString()}</Text><Text style={s.heroSub}>{mine?'Rank #'+mine.rank+' · keep it up':'Connect and sync to join'}</Text><Text style={s.arrow}>↗</Text></View>
      <Text style={s.sync}>{message}</Text>
      <Pressable style={s.primary} onPress={sync} disabled={busy}><Text style={s.primaryText}>{busy?'Syncing…':connected?'Sync steps again':'Connect health & sync steps'}</Text></Pressable>
      <View style={s.headline}><Text style={s.section}>Leaderboard</Text><Text style={s.wallet}>🪙 {data?.wallet.coins||0} · {data?.wallet.points||0} pts</Text></View>
      {data?.entries.length?data.entries.map((entry)=><View key={entry.id} style={[s.row,entry.id===user.id&&s.myRow]}><Text style={s.rank}>{String(entry.rank).padStart(2,'0')}</Text><View style={s.smallAvatar}><Text style={s.smallAvatarText}>{entry.name.slice(0,2).toUpperCase()}</Text></View><Text style={s.person}>{entry.id===user.id?'You':entry.name}</Text><Text style={s.count}>{entry.steps.toLocaleString()}<Text style={s.unit}> steps</Text></Text></View>):<Text style={s.muted}>No verified uploads yet. Sync to appear here.</Text>}
      <Text style={s.note}>Day closes at midnight IST. Uploads accepted until 12:30 AM; then results are final. Unsynced users are unverified.</Text>
      <Pressable onPress={async()=>{await logout();setUser(null);setData(null);setConnected(false);}}><Text style={s.signOut}>Sign out</Text></Pressable>
    </>}
  </ScrollView></SafeAreaView>
}
const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:C.bg},content:{padding:23,paddingBottom:50},brand:{color:C.text,fontSize:14,fontWeight:'900',letterSpacing:4,marginBottom:28},brandAccent:{color:C.lime},
  auth:{paddingTop:50},title:{color:C.text,fontSize:31,fontWeight:'900',letterSpacing:-1.2,lineHeight:36},muted:{color:C.muted,fontSize:14,marginTop:12},input:{backgroundColor:C.panel,color:C.text,borderRadius:12,padding:16,marginTop:14,borderWidth:1,borderColor:C.line},
  primary:{backgroundColor:C.lime,borderRadius:12,padding:15,alignItems:'center',marginTop:16},primaryText:{color:'#192417',fontWeight:'900',fontSize:14},link:{color:C.lime,textAlign:'center',marginTop:18},notice:{color:C.muted,marginTop:18,lineHeight:20},
  header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},overline:{color:C.muted,fontSize:10,letterSpacing:2,fontWeight:'800',marginBottom:8},avatar:{backgroundColor:C.lime,width:42,height:42,borderRadius:22,alignItems:'center',justifyContent:'center'},avatarText:{fontWeight:'900',color:'#192417'},
  tabs:{flexDirection:'row',backgroundColor:C.panel,borderRadius:14,padding:4,marginTop:24,marginBottom:18},tab:{flex:1,alignItems:'center',padding:10,borderRadius:10},selected:{backgroundColor:C.lime},tabText:{color:C.muted,fontWeight:'800'},selectedText:{color:'#192417'},
  hero:{backgroundColor:C.purple,borderRadius:20,padding:20,minHeight:156,overflow:'hidden'},heroLabel:{color:'#ded2ff',fontWeight:'800',fontSize:11,letterSpacing:1},heroNumber:{color:'white',fontWeight:'900',fontSize:50,letterSpacing:-2,marginTop:4},heroSub:{color:'#e7ddff',fontSize:12},arrow:{position:'absolute',right:9,bottom:-28,color:'#a1ff70',fontSize:100,fontWeight:'200',opacity:.8},
  sync:{color:C.muted,marginTop:12,fontSize:12},headline:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:28,marginBottom:10},section:{color:C.text,fontWeight:'900',fontSize:19},wallet:{color:C.lime,fontSize:12,fontWeight:'800'},
  row:{flexDirection:'row',alignItems:'center',backgroundColor:C.panel,borderRadius:13,padding:12,marginBottom:8,borderWidth:1,borderColor:C.line},myRow:{borderColor:C.lime},rank:{color:C.muted,width:30,fontWeight:'800'},smallAvatar:{width:32,height:32,borderRadius:16,backgroundColor:'#38475d',alignItems:'center',justifyContent:'center'},smallAvatarText:{color:C.text,fontSize:10,fontWeight:'800'},person:{color:C.text,fontWeight:'800',flex:1,marginLeft:10},count:{color:C.text,fontWeight:'900'},unit:{fontSize:10,fontWeight:'400',color:C.muted},
  note:{color:C.muted,fontSize:11,lineHeight:17,marginTop:16},signOut:{color:C.muted,textAlign:'center',marginTop:28}
  ,groupPanel:{backgroundColor:C.panel,borderRadius:14,padding:14,marginTop:20,borderWidth:1,borderColor:C.line},groupHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},groupChip:{borderWidth:1,borderColor:C.line,borderRadius:20,paddingHorizontal:15,paddingVertical:9,marginRight:8,marginTop:10},groupChipActive:{backgroundColor:C.lime,borderColor:C.lime},groupChipText:{color:C.text,fontWeight:'800'},groupChipTextActive:{color:'#192417'},linkInline:{color:C.lime,fontWeight:'800',paddingVertical:8},secondary:{backgroundColor:'#35465d',borderRadius:10,padding:12,alignItems:'center',marginTop:8},secondaryText:{color:C.text,fontWeight:'800'}
});
