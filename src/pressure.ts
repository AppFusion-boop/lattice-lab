export type PressureConfig={length:number;height:number;distance:number;damping:number;fillMs:number;ends:'open'|'closed'};
export const pressureDefaults:PressureConfig={length:60,height:12,distance:18,damping:35,fillMs:60,ends:'open'};
export type PressureFrame={time:number;dry:Float32Array;mist:Float32Array;probeDry:number;probeMist:number};
export type PressureSimulation={nx:number;ny:number;dt:number;duration:number;frames:PressureFrame[];config:PressureConfig;peakDry:number;peakMist:number};
export function solvePressure(config:PressureConfig):PressureSimulation{
 const {length,height,distance,damping,fillMs,ends}=config;
 if(![length,height,distance,damping,fillMs].every(Number.isFinite)||length<30||length>120||height<6||height>20||distance<2||distance>length/2-2||damping<0||damping>80||fillMs<10||fillMs>200)throw Error('Invalid scene configuration');
 const nx=201,ny=41,c=343,dx=length/(nx-1),dy=height/(ny-1),dt=.48/(c*Math.sqrt(1/dx**2+1/dy**2));
 const cx=(c*dt/dx)**2,cy=(c*dt/dy)**2;const size=nx*ny;const duration=length/c*1.65;const steps=Math.ceil(duration/dt),stride=Math.max(1,Math.round(steps/150));
 let dry=new Float32Array(size),oldDry=new Float32Array(size),nextDry=new Float32Array(size),wet=new Float32Array(size),oldWet=new Float32Array(size),nextWet=new Float32Array(size);
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const r2=(x*dx-length/2)**2+(y*dy-height/2)**2;dry[y*nx+x]=Math.exp(-r2/(2*.8**2));}oldDry.set(dry);wet.set(dry);oldWet.set(dry);
 const probeX=Math.round((length/2+distance)/dx),probeY=Math.round((height-1.3)/dy),probeIndex=probeY*nx+probeX;const frames:PressureFrame[]=[];let peakDry=0,peakMist=0;
 const record=(time:number)=>{frames.push({time,dry:dry.slice(),mist:wet.slice(),probeDry:dry[probeIndex],probeMist:wet[probeIndex]});};record(0);
 const mur=(c*dt-dx)/(c*dt+dx);
 for(let step=1;step<=steps;step++){const time=step*dt,front=Math.min(1,time/(fillMs/1000));
 for(let y=0;y<ny;y++){const up=(y===0?1:y-1)*nx,down=(y===ny-1?ny-2:y+1)*nx;const coverage=Math.max(0,Math.min(1,(front-y/(ny-1))/.15));for(let x=0;x<nx;x++){const i=y*nx+x,l=y*nx+(x===0?1:x-1),r=y*nx+(x===nx-1?nx-2:x+1);const dryGamma=.7;const inMist=Math.abs(x*dx-length/2)<length*.3;const gamma=dryGamma+(inMist?damping*coverage:0);const d=dry[i],p=wet[i];nextDry[i]=(2*d-(1-dryGamma*dt/2)*oldDry[i]+cx*(dry[l]+dry[r]-2*d)+cy*(dry[up+x]+dry[down+x]-2*d))/(1+dryGamma*dt/2);nextWet[i]=(2*p-(1-gamma*dt/2)*oldWet[i]+cx*(wet[l]+wet[r]-2*p)+cy*(wet[up+x]+wet[down+x]-2*p))/(1+gamma*dt/2);}}
 if(ends==='open'){for(let y=0;y<ny;y++){const l=y*nx,r=l+nx-1;nextDry[l]=dry[l+1]+mur*(nextDry[l+1]-dry[l]);nextDry[r]=dry[r-1]+mur*(nextDry[r-1]-dry[r]);nextWet[l]=wet[l+1]+mur*(nextWet[l+1]-wet[l]);nextWet[r]=wet[r-1]+mur*(nextWet[r-1]-wet[r]);}}
 [oldDry,dry,nextDry]=[dry,nextDry,oldDry];[oldWet,wet,nextWet]=[wet,nextWet,oldWet];peakDry=Math.max(peakDry,Math.abs(dry[probeIndex]));peakMist=Math.max(peakMist,Math.abs(wet[probeIndex]));if(step%stride===0||step===steps)record(time);
 }
 return {nx,ny,dt,duration:frames[frames.length-1].time,frames,config,peakDry,peakMist};
}
