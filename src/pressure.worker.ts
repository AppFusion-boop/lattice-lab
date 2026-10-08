import {solvePressure,type PressureConfig} from './pressure';
self.onmessage=(event:MessageEvent<PressureConfig>)=>{try{const result=solvePressure(event.data);const transfers=result.frames.flatMap(f=>[f.dry.buffer,f.mist.buffer]);self.postMessage({result},{transfer:transfers});}catch(error){self.postMessage({error:(error as Error).message});}};
