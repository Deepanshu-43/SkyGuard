import React from 'react';
import { DroneSimulation } from './components/DroneSimulation';

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <nav className="w-full bg-slate-900 border-b border-slate-800 p-4 mb-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
           <div className="flex items-center gap-3">
             <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white">D</div>
             <h1 className="text-xl font-bold tracking-tight text-white">SkyGuard <span className="text-blue-500">Sim</span></h1>
           </div>
           <div className="text-xs font-mono text-slate-500">v1.2.4-stable</div>
        </div>
      </nav>
      
      <main>
        <DroneSimulation />
      </main>
    </div>
  );
}