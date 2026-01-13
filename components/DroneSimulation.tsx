
import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Plus, Minus, Shield, Grid, Crosshair, Zap, Activity, Radio, Wifi, WifiOff, Skull, Home, AlertTriangle, Layout } from 'lucide-react';

// --- Constants & Types ---

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const THREATENING_RANGE = 150;
const FIRING_RANGE = 50;
const JAMMING_RANGE = 100;
const DRONE_SPEED = 2;
const BOMBER_SPEED = 1.2;
const HOSTILE_SPEED = 1.5;
const MINIMAP_SIZE = 150;
const RADAR_SIZE = 150;
const UI_UPDATE_RATE = 100;

type FormationType = 'circle' | 'arrowhead' | 'spearhead' | 'double-file' | 'extended-line';

interface Asset {
  x: number;
  y: number;
  size: number;
  type: string;
  label: string;
  priority: number;
  health: number;
  maxHealth: number;
}

interface MapConfig {
  name: string;
  assets: Asset[];
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface SimState {
  friendlyDrones: Drone[];
  hostileDrones: Drone[];
  groundAssets: Asset[];
  destroyedAssets: Asset[];
  particles: Particle[];
  animationId: number | null;
  friendlyLosses: number;
}

interface MapConfigs {
  [key: string]: MapConfig;
}

interface DroneData {
  id: string;
  x: number;
  y: number;
  targetId: string | null;
  health: number;
  isEngaging: boolean;
  isJammed: boolean;
  type: 'drone' | 'bomber';
  isLost: boolean;
}

// --- Class Definition ---

class Drone {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  isFriendly: boolean;
  type: 'drone' | 'bomber';
  target: Drone | null;
  health: number;
  isEngaging: boolean;
  trail: { x: number; y: number }[];
  lastFired: number;
  
  // Feature 3: Lost Reconnection
  lostCoords: { x: number; y: number } | null = null;
  
  // Jamming props
  isJammed: boolean;
  jammingTargets: Drone[];

  constructor(id: string, x: number, y: number, isFriendly: boolean, type: 'drone' | 'bomber' = 'drone') {
    this.id = id;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.isFriendly = isFriendly;
    this.type = type;
    this.target = null;
    this.health = type === 'bomber' ? 150 : 100;
    this.isEngaging = false;
    this.trail = [];
    this.lastFired = 0;
    
    this.isJammed = false;
    this.jammingTargets = [];
  }

  calculateDistance(other: { x: number; y: number }): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  moveTo(tx: number, ty: number, speed: number) {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 1) {
      this.vx = (dx / dist) * speed;
      this.vy = (dy / dist) * speed;
      this.x += this.vx;
      this.y += this.vy;
    }

    // Update trail
    this.trail.unshift({ x: this.x, y: this.y });
    if (this.trail.length > 10) {
      this.trail.pop();
    }
  }

  fireAt(target: { x: number; y: number; health: number }, addParticle: (p: Particle) => void, color: string, damage: number = 2) {
      if (Date.now() - this.lastFired < 100) return;
      
      this.lastFired = Date.now();
      target.health -= damage;

      for (let i = 0; i < 2; i++) {
        addParticle({
            x: target.x + (Math.random() - 0.5) * 10,
            y: target.y + (Math.random() - 0.5) * 10,
            vx: (Math.random() - 0.5) * 4,
            vy: (Math.random() - 0.5) * 4,
            life: 10 + Math.random() * 10,
            maxLife: 20,
            color: color,
            size: 1 + Math.random() * 2
        });
      }
  }

  update(friendlyDrones: Drone[], hostileDrones: Drone[], groundAssets: Asset[], hasCommunication: boolean, jammingEnabled: boolean, addParticle: (p: Particle) => void, formation: FormationType) {
    this.jammingTargets = [];
    
    // --- FRIENDLY LOGIC ---
    if (this.isFriendly) {
      
      // Feature 1: Autonomous mode when communication lost
      if (!hasCommunication) {
        const groundThreat = Math.random() < 0.7;
        if (groundThreat && groundAssets.length > 0) {
          // Find nearest asset
          const nearestAsset = groundAssets.reduce((closest, asset) => 
            this.calculateDistance(asset) < this.calculateDistance(closest) ? asset : closest
          );
          this.moveTo(nearestAsset.x, nearestAsset.y, DRONE_SPEED);
        } else if (hostileDrones.length > 0) {
          // Find nearest hostile
          const nearestHostile = hostileDrones.reduce((closest, hostile) => 
            this.calculateDistance(hostile) < this.calculateDistance(closest) ? hostile : closest
          );
          this.moveTo(nearestHostile.x, nearestHostile.y, DRONE_SPEED);
        } else {
            // Idle hover if no targets
            this.x += (Math.random() - 0.5);
            this.y += (Math.random() - 0.5);
        }
        return; // Autonomous mode overrides other logic
      }

      // Feature 3: Lost drone reconnection (if comms active)
      if (hasCommunication) {
         let performingRescue = false;
         
         // Check for lost neighbors
         friendlyDrones.forEach(friend => {
            if (friend !== this && friend.lostCoords) {
                const dist = this.calculateDistance(friend);
                if (dist < 100) {
                    friend.lostCoords = null; // Reconnected
                } else if (!performingRescue) {
                    // Move to last known coords to help
                    this.moveTo(friend.lostCoords.x, friend.lostCoords.y, DRONE_SPEED * 0.8);
                    performingRescue = true;
                }
            }
         });

         // Mark self as lost if too far from swarm center
         if (friendlyDrones.length > 1) {
             const avgX = friendlyDrones.reduce((sum, f) => sum + f.x, 0) / friendlyDrones.length;
             const avgY = friendlyDrones.reduce((sum, f) => sum + f.y, 0) / friendlyDrones.length;
             if (this.calculateDistance({x: avgX, y: avgY}) > 300 && !this.lostCoords) {
                 this.lostCoords = { x: this.x, y: this.y };
             }
         }

         // If we are moving to rescue, skip normal engagement to prioritize connection
         if (performingRescue) {
             return;
         }
      }

      // Existing Logic: Jamming
      if (jammingEnabled) {
        hostileDrones.forEach(h => {
          if (h.health > 0 && this.calculateDistance(h) <= JAMMING_RANGE) {
            h.isJammed = true;
            this.jammingTargets.push(h);
            h.health -= 0.1; 
            
            if (Math.random() < 0.1) {
              addParticle({
                x: h.x + (Math.random() - 0.5) * 10,
                y: h.y + (Math.random() - 0.5) * 10,
                vx: (Math.random() - 0.5) * 2,
                vy: (Math.random() - 0.5) * 2,
                life: 10,
                maxLife: 10,
                color: '#a855f7',
                size: 1.5
              });
            }
          }
        });
      }

      // Friendly decision logic
      let highestPriorityTarget: Drone | null = null;
      let highestThreatLevel = -Infinity;

      hostileDrones.forEach(hostile => {
        const threatScore = this.calculateThreatScore(hostile, groundAssets, friendlyDrones, hasCommunication);
        if (threatScore > highestThreatLevel) {
          highestThreatLevel = threatScore;
          highestPriorityTarget = hostile;
        }
      });

      if (highestPriorityTarget) {
        this.target = highestPriorityTarget;
        this.isEngaging = true;

        const isCritical = this.isCriticalThreat(highestPriorityTarget, groundAssets);

        if (isCritical || this.shouldEngage(highestPriorityTarget, friendlyDrones)) {
            const dist = this.calculateDistance(highestPriorityTarget);
            if (dist <= FIRING_RANGE) {
                // Boost bomber destruction capability 10x
                const damage = this.type === 'bomber' ? 20 : 2; 
                this.fireAt(highestPriorityTarget, addParticle, '#fbbf24', damage);
            } else {
                this.moveTo(highestPriorityTarget.x, highestPriorityTarget.y, DRONE_SPEED);
            }
        } else {
          this.maintainDefensivePosition(groundAssets);
        }
      } else {
        this.target = null;
        this.isEngaging = false;
        this.patrolPosition(groundAssets, friendlyDrones, formation);
      }
      return;
    }

    // --- HOSTILE LOGIC ---
    
    let currentSpeed = this.type === 'bomber' ? BOMBER_SPEED : HOSTILE_SPEED;
    if (this.isJammed) {
      currentSpeed *= 0.2;
    }

    // Target selection: Ground Asset (Primary) vs Friendly Drone (Self Defense)
    let nearestAsset: Asset | null = null;
    let minAssetDist = Infinity;
    
    groundAssets.forEach(asset => {
        const d = this.calculateDistance(asset);
        if (d < minAssetDist) {
            minAssetDist = d;
            nearestAsset = asset;
        }
    });

    let nearestFriendly: Drone | null = null;
    let minFriendlyDist = Infinity;
    
    friendlyDrones.forEach(f => {
        const d = this.calculateDistance(f);
        if (d < minFriendlyDist) {
            minFriendlyDist = d;
            nearestFriendly = f;
        }
    });

    // Combat Logic
    if (!this.isJammed) {
        // Priority 1: Self defense if friendly is very close
        if (nearestFriendly && minFriendlyDist <= FIRING_RANGE) {
             const dmg = this.type === 'bomber' ? 15 : 1.5; // 10x base damage
             this.fireAt(nearestFriendly, addParticle, '#ef4444', dmg);
        } 
        // Priority 2: Mission objective (Ground Assets)
        else if (nearestAsset && minAssetDist <= FIRING_RANGE) {
             // Bombers do more damage to structures (10x base)
             const dmg = this.type === 'bomber' ? 50 : 5; 
             this.fireAt(nearestAsset, addParticle, '#f97316', dmg);
        }
        // Priority 3: Attack friendly if no assets in range but friendly is somewhat close
        else if (nearestFriendly && minFriendlyDist <= FIRING_RANGE * 1.5) {
             this.moveTo(nearestFriendly.x, nearestFriendly.y, currentSpeed);
        }
    }

    // Movement Logic
    if (nearestAsset) {
        if (minAssetDist > FIRING_RANGE * 0.8) {
             this.moveTo(nearestAsset.x, nearestAsset.y, currentSpeed);
        }
    } else if (nearestFriendly) {
        this.moveTo(nearestFriendly.x, nearestFriendly.y, currentSpeed);
    }
  }

  calculateThreatScore(hostile: Drone, groundAssets: Asset[], friendlyDrones: Drone[], hasCommunication: boolean) {
    let score = 0;

    // Find nearest ground asset
    let minDist = Infinity;
    let targetPriority = 5;
    groundAssets.forEach(asset => {
      const d = hostile.calculateDistance(asset);
      if (d < minDist) {
        minDist = d;
        targetPriority = asset.priority || 5;
      }
    });

    // Critical: threatening range
    if (minDist <= THREATENING_RANGE) {
      score += 1000 + (targetPriority * 10);
    }

    // Check if friendly bombers exist to take on heavy targets
    const friendlyBombersExist = friendlyDrones.some(d => d.type === 'bomber' && d.health > 0);

    // If I am a small drone and we have heavy support, focus on small targets
    if (this.type === 'drone' && friendlyBombersExist) {
        if (hostile.type === 'drone') {
            score += 2000; // Prioritize small drones
        } else {
            score -= 500; // Deprioritize bombers (let the big guys handle it)
        }
    } else {
        // Standard logic: Bombers are dangerous, kill them first
        if (hostile.type === 'bomber') {
            score += 500;
        }
    }

    // Ground attack capability
    score += 100;

    // Proximity to self
    const distToSelf = this.calculateDistance(hostile);
    score += 50 / (distToSelf + 1);

    // Consider if already engaged (if communication enabled)
    if (hasCommunication) {
      let engagementCount = 0;
      friendlyDrones.forEach(friend => {
        if (friend !== this && friend.target === hostile) {
          engagementCount++;
        }
      });
      score -= engagementCount * 30;
    }

    return score;
  }

  isCriticalThreat(hostile: Drone, groundAssets: Asset[]) {
    let minDist = Infinity;
    groundAssets.forEach(asset => {
      const d = hostile.calculateDistance(asset);
      if (d < minDist) minDist = d;
    });
    return minDist <= THREATENING_RANGE;
  }

  shouldEngage(target: Drone, friendlyDrones: Drone[]) {
    const myDistance = this.calculateDistance(target);

    let currentEngagers = 0;
    friendlyDrones.forEach(friend => {
      if (friend !== this && friend.target === target) {
        currentEngagers++;
      }
    });

    const engagementRatio = currentEngagers / friendlyDrones.length;
    return myDistance < 200 || engagementRatio < 0.3;
  }

  maintainDefensivePosition(groundAssets: Asset[]) {
    if (groundAssets.length === 0) return;
    const centerX = groundAssets.reduce((sum, a) => sum + a.x, 0) / groundAssets.length;
    const centerY = groundAssets.reduce((sum, a) => sum + a.y, 0) / groundAssets.length;

    const dist = Math.sqrt((this.x - centerX) ** 2 + (this.y - centerY) ** 2);
    if (dist > 100) {
      this.moveTo(centerX, centerY, DRONE_SPEED * 0.5);
    }
  }

  patrolPosition(groundAssets: Asset[], friendlyDrones: Drone[], formation: FormationType) {
    if (groundAssets.length === 0) return;
    const centerX = groundAssets.reduce((sum, a) => sum + a.x, 0) / groundAssets.length;
    const centerY = groundAssets.reduce((sum, a) => sum + a.y, 0) / groundAssets.length;
    
    // Find my index to determine position in formation
    const index = friendlyDrones.indexOf(this);
    if (index === -1) return;

    if (formation === 'circle') {
        const angle = Math.atan2(this.y - centerY, this.x - centerX);
        const orbitRadius = 120;
        const targetX = centerX + Math.cos(angle + 0.02) * orbitRadius;
        const targetY = centerY + Math.sin(angle + 0.02) * orbitRadius;
        this.moveTo(targetX, targetY, DRONE_SPEED * 0.3);
    } else {
        const spacing = 50;
        let targetOffsetX = 0;
        let targetOffsetY = 0;

        switch (formation) {
            case 'arrowhead':
                // V formation pointing North-ish
                if (index === 0) {
                    targetOffsetX = 0;
                    targetOffsetY = -spacing * 1.5;
                } else {
                    const row = Math.floor((index + 1) / 2);
                    const side = index % 2 === 0 ? 1 : -1;
                    targetOffsetX = side * row * spacing;
                    targetOffsetY = -spacing * 1.5 + row * spacing;
                }
                break;
            case 'spearhead':
                // Diamond / Filled Triangle
                let remaining = index;
                let r = 0;
                while (remaining >= r + 1) {
                    remaining -= (r + 1);
                    r++;
                }
                const rowWidth = (r + 1) * spacing;
                const startX = -rowWidth / 2 + spacing / 2;
                targetOffsetX = startX + remaining * spacing;
                targetOffsetY = (r - 1.5) * spacing;
                break;
            case 'double-file':
                const dfRow = Math.floor(index / 2);
                const dfCol = index % 2 === 0 ? -1 : 1;
                targetOffsetX = dfCol * spacing * 0.8;
                targetOffsetY = (dfRow - friendlyDrones.length/4) * spacing;
                break;
            case 'extended-line':
                targetOffsetX = (index - friendlyDrones.length/2) * spacing;
                targetOffsetY = 0;
                break;
        }

        const targetX = centerX + targetOffsetX;
        const targetY = centerY + targetOffsetY;
        
        // Move towards formation slot but check distance
        const distToSlot = Math.sqrt((targetX - this.x)**2 + (targetY - this.y)**2);
        
        if (distToSlot > 5) {
             this.moveTo(targetX, targetY, DRONE_SPEED * 0.5);
        }
    }

    // Maintain visible distance (flocking separation)
    this.applySeparation(friendlyDrones, 40);
  }

  applySeparation(drones: Drone[], separationDist: number) {
    let sepX = 0;
    let sepY = 0;
    let count = 0;
    
    drones.forEach(other => {
        if (other !== this && other.health > 0) {
            const d = this.calculateDistance(other);
            if (d < separationDist && d > 0) {
                const force = (separationDist - d) / separationDist;
                sepX += (this.x - other.x) / d * force;
                sepY += (this.y - other.y) / d * force;
                count++;
            }
        }
    });

    if (count > 0) {
        this.x += sepX * 1.5;
        this.y += sepY * 1.5;
    }
  }
}

// --- Data ---

const mapConfigs: MapConfigs = {
  base: {
    name: 'Military Base',
    assets: [
      { x: 400, y: 300, size: 30, type: 'command', label: 'Command Center', priority: 10, health: 3000, maxHealth: 3000 },
      { x: 300, y: 280, size: 20, type: 'aa', label: 'AA Gun', priority: 7, health: 1000, maxHealth: 1000 },
      { x: 500, y: 320, size: 20, type: 'aa', label: 'AA Gun', priority: 7, health: 1000, maxHealth: 1000 },
      { x: 350, y: 350, size: 15, type: 'radar', label: 'Radar', priority: 8, health: 800, maxHealth: 800 },
      { x: 450, y: 250, size: 15, type: 'supply', label: 'Supply Depot', priority: 5, health: 1200, maxHealth: 1200 }
    ]
  },
  city: {
    name: 'Urban Area',
    assets: [
      { x: 400, y: 300, size: 35, type: 'hospital', label: 'Hospital', priority: 10, health: 2500, maxHealth: 2500 },
      { x: 300, y: 250, size: 25, type: 'building', label: 'Office Tower', priority: 6, health: 1500, maxHealth: 1500 },
      { x: 500, y: 280, size: 25, type: 'building', label: 'Apartment', priority: 8, health: 1500, maxHealth: 1500 },
      { x: 350, y: 380, size: 20, type: 'power', label: 'Power Station', priority: 9, health: 2000, maxHealth: 2000 },
      { x: 480, y: 360, size: 18, type: 'building', label: 'School', priority: 9, health: 1500, maxHealth: 1500 }
    ]
  },
  convoy: {
    name: 'Supply Convoy',
    assets: [
      { x: 350, y: 300, size: 18, type: 'vehicle', label: 'Supply Truck', priority: 6, health: 500, maxHealth: 500 },
      { x: 400, y: 300, size: 18, type: 'vehicle', label: 'Supply Truck', priority: 6, health: 500, maxHealth: 500 },
      { x: 450, y: 300, size: 18, type: 'vehicle', label: 'Supply Truck', priority: 6, health: 500, maxHealth: 500 },
      { x: 320, y: 300, size: 20, type: 'armor', label: 'APC', priority: 8, health: 800, maxHealth: 800 },
      { x: 480, y: 300, size: 20, type: 'armor', label: 'Tank', priority: 7, health: 1200, maxHealth: 1200 }
    ]
  },
  airport: {
    name: 'Military Airfield',
    assets: [
      { x: 400, y: 280, size: 30, type: 'tower', label: 'Control Tower', priority: 9, health: 2000, maxHealth: 2000 },
      { x: 300, y: 320, size: 22, type: 'hangar', label: 'Hangar 1', priority: 7, health: 2500, maxHealth: 2500 },
      { x: 500, y: 320, size: 22, type: 'hangar', label: 'Hangar 2', priority: 7, health: 2500, maxHealth: 2500 },
      { x: 400, y: 360, size: 18, type: 'fuel', label: 'Fuel Depot', priority: 10, health: 1000, maxHealth: 1000 },
      { x: 350, y: 240, size: 16, type: 'radar', label: 'Radar', priority: 8, health: 800, maxHealth: 800 }
    ]
  }
};

// --- Component ---

export const DroneSimulation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [friendlyCount, setFriendlyCount] = useState(8);
  const [hostileCount, setHostileCount] = useState(5);
  const [communication, setCommunication] = useState(true);
  const [jammingEnabled, setJammingEnabled] = useState(false);
  const [selectedMap, setSelectedMap] = useState('base');
  const [radarRotation, setRadarRotation] = useState(0);
  const [formation, setFormation] = useState<FormationType>('circle');

  // Feature 2: Bomber State
  const [bomberCount, setBomberCount] = useState(0);
  const [hostileBomberCount, setHostileBomberCount] = useState(0);

  const [uiData, setUiData] = useState<{
      stats: { engaged: number; threats: number; eliminated: number; integrity: number; friendlyLosses: number };
      friendlyDrones: DroneData[];
      hostileDrones: DroneData[];
  }>({
      stats: { engaged: 0, threats: 0, eliminated: 0, integrity: 100, friendlyLosses: 0 },
      friendlyDrones: [],
      hostileDrones: []
  });

  const lastUiUpdate = useRef(0);

  const simRef = useRef<SimState>({
    friendlyDrones: [],
    hostileDrones: [],
    groundAssets: [],
    destroyedAssets: [],
    particles: [],
    animationId: null,
    friendlyLosses: 0
  });

  const initSimulation = () => {
    const sim = simRef.current;

    const mapConfig = mapConfigs[selectedMap];
    sim.groundAssets = mapConfig.assets.map(asset => ({ ...asset }));
    sim.destroyedAssets = [];
    sim.particles = [];
    sim.friendlyLosses = 0;

    sim.friendlyDrones = [];
    const centerX = sim.groundAssets.reduce((sum, a) => sum + a.x, 0) / sim.groundAssets.length;
    const centerY = sim.groundAssets.reduce((sum, a) => sum + a.y, 0) / sim.groundAssets.length;

    // Friendly Interceptors
    for (let i = 0; i < friendlyCount; i++) {
      let x = centerX;
      let y = centerY;
      
      // Attempt to spawn in rough formation position to avoid initial clump
      if (formation === 'circle') {
          const angle = (i / friendlyCount) * Math.PI * 2;
          x = centerX + Math.cos(angle) * 150;
          y = centerY + Math.sin(angle) * 150;
      } else {
          // Simple offset calculation used in patrol
          // We recreate simplified logic here just for init spawn
          const spacing = 50;
          if (formation === 'extended-line') {
             x = centerX + (i - friendlyCount/2) * spacing;
          } else if (formation === 'double-file') {
             y = centerY + (Math.floor(i/2) - friendlyCount/4) * spacing;
          } else {
             // For wedge/spearhead just clump slightly offset
             x = centerX + (i % 2 === 0 ? 1 : -1) * (i * 10);
             y = centerY + (i * 10);
          }
      }
      
      sim.friendlyDrones.push(new Drone(`F-${i + 1}`, x, y, true, 'drone'));
    }

    // Feature 2: Friendly Bombers
    if (bomberCount > 0) {
      for (let i = 0; i < bomberCount; i++) {
        const x = Math.random() * CANVAS_WIDTH * 0.3; // Start on left side
        const y = Math.random() * CANVAS_HEIGHT;
        const bomber = new Drone(`B-${i+1}`, x, y, true, 'bomber');
        sim.friendlyDrones.push(bomber);
      }
    }

    // Hostile Interceptors
    sim.hostileDrones = [];
    for (let i = 0; i < hostileCount; i++) {
      const edge = Math.floor(Math.random() * 4);
      let x = 0, y = 0;
      switch (edge) {
        case 0: x = Math.random() * CANVAS_WIDTH; y = 0; break;
        case 1: x = CANVAS_WIDTH; y = Math.random() * CANVAS_HEIGHT; break;
        case 2: x = Math.random() * CANVAS_WIDTH; y = CANVAS_HEIGHT; break;
        case 3: x = 0; y = Math.random() * CANVAS_HEIGHT; break;
      }
      sim.hostileDrones.push(new Drone(`H-${i + 1}`, x, y, false, 'drone'));
    }

    // Feature 2: Hostile Bombers
    if (hostileBomberCount > 0) {
      for (let i = 0; i < hostileBomberCount; i++) {
        const x = CANVAS_WIDTH - (Math.random() * 100); // Start on right side
        const y = Math.random() * CANVAS_HEIGHT;
        const bomber = new Drone(`HB-${i+1}`, x, y, false, 'bomber');
        sim.hostileDrones.push(bomber);
      }
    }
  };

  const createExplosion = (x: number, y: number, color: string, scale: number = 1) => {
      const sim = simRef.current;
      const count = 20 * scale;
      for (let i = 0; i < count; i++) {
          sim.particles.push({
              x: x,
              y: y,
              vx: (Math.random() - 0.5) * 8 * scale,
              vy: (Math.random() - 0.5) * 8 * scale,
              life: 20 + Math.random() * 20,
              maxLife: 40,
              color: color,
              size: (2 + Math.random() * 4) * scale
          });
      }
  };

  const drawLidarMap = (ctx: CanvasRenderingContext2D, sim: SimState) => {
    const offsetX = 10;
    const offsetY = 10;
    const scale = MINIMAP_SIZE / CANVAS_WIDTH;

    ctx.fillStyle = 'rgba(17, 24, 39, 0.9)';
    ctx.fillRect(offsetX, offsetY, MINIMAP_SIZE, MINIMAP_SIZE);
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 1;
    ctx.strokeRect(offsetX, offsetY, MINIMAP_SIZE, MINIMAP_SIZE);

    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('LIDAR', offsetX + 5, offsetY + 15);

    // Grid
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.2)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const pos = offsetX + (i * MINIMAP_SIZE / 4);
      ctx.beginPath();
      ctx.moveTo(pos, offsetY);
      ctx.lineTo(pos, offsetY + MINIMAP_SIZE);
      ctx.stroke();

      const posY = offsetY + (i * MINIMAP_SIZE / 4);
      ctx.beginPath();
      ctx.moveTo(offsetX, posY);
      ctx.lineTo(offsetX + MINIMAP_SIZE, posY);
      ctx.stroke();
    }

    // Assets
    sim.groundAssets.forEach(asset => {
      const x = offsetX + asset.x * scale;
      const y = offsetY + asset.y * scale;
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(x - 1, y - 1, 2, 2);
    });

    sim.hostileDrones.forEach(drone => {
      if (drone.health > 0) {
        const x = offsetX + drone.x * scale;
        const y = offsetY + drone.y * scale;
        ctx.fillStyle = drone.isJammed ? '#a855f7' : '#ef4444';
        const s = drone.type === 'bomber' ? 4 : 2;
        ctx.fillRect(x - s/2, y - s/2, s, s);
      }
    });

    sim.friendlyDrones.forEach(drone => {
      const x = offsetX + drone.x * scale;
      const y = offsetY + drone.y * scale;
      ctx.fillStyle = drone.lostCoords ? '#facc15' : '#3b82f6';
      const s = drone.type === 'bomber' ? 4 : 2;
      ctx.fillRect(x - s/2, y - s/2, s, s);
    });
  };

  const drawRadarDisplay = (ctx: CanvasRenderingContext2D, sim: SimState) => {
    const offsetX = CANVAS_WIDTH - RADAR_SIZE - 10;
    const offsetY = 10;
    const centerX = offsetX + RADAR_SIZE / 2;
    const centerY = offsetY + RADAR_SIZE / 2;

    ctx.fillStyle = 'rgba(17, 24, 39, 0.9)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, RADAR_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, RADAR_SIZE / 2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#06b6d4';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('RADAR', offsetX + 5, offsetY + 15);

    ctx.strokeStyle = 'rgba(6, 182, 212, 0.3)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, (RADAR_SIZE / 2) * (i / 3), 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(centerX, offsetY);
    ctx.lineTo(centerX, offsetY + RADAR_SIZE);
    ctx.moveTo(offsetX, centerY);
    ctx.lineTo(offsetX + RADAR_SIZE, centerY);
    ctx.stroke();

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(radarRotation);
    const gradient = ctx.createLinearGradient(0, 0, RADAR_SIZE / 2, 0);
    gradient.addColorStop(0, 'rgba(6, 182, 212, 0)');
    gradient.addColorStop(1, 'rgba(6, 182, 212, 0.8)');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(RADAR_SIZE / 2, 0);
    ctx.stroke();
    ctx.restore();

    const mapCenter = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
    const radarRange = 300;

    sim.hostileDrones.forEach(drone => {
      if (drone.health > 0) {
        const dx = drone.x - mapCenter.x;
        const dy = drone.y - mapCenter.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < radarRange) {
          const radarX = centerX + (dx / radarRange) * (RADAR_SIZE / 2);
          const radarY = centerY + (dy / radarRange) * (RADAR_SIZE / 2);
          const pulseSize = (drone.type === 'bomber' ? 4 : 2) + Math.sin(Date.now() / 150) * 1;
          
          ctx.fillStyle = drone.isJammed ? '#a855f7' : '#ef4444';
          ctx.beginPath();
          if (drone.type === 'bomber') {
              ctx.rect(radarX - pulseSize/2, radarY - pulseSize/2, pulseSize, pulseSize);
          } else {
              ctx.arc(radarX, radarY, pulseSize, 0, Math.PI * 2);
          }
          ctx.fill();
        }
      }
    });

    sim.friendlyDrones.forEach(drone => {
      const dx = drone.x - mapCenter.x;
      const dy = drone.y - mapCenter.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < radarRange) {
        const radarX = centerX + (dx / radarRange) * (RADAR_SIZE / 2);
        const radarY = centerY + (dy / radarRange) * (RADAR_SIZE / 2);
        ctx.fillStyle = drone.lostCoords ? '#facc15' : '#3b82f6';
        ctx.beginPath();
        if (drone.type === 'bomber') {
            ctx.rect(radarX - 2, radarY - 2, 4, 4);
        } else {
            ctx.arc(radarX, radarY, 1.5, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    });
  };

  const drawSimulation = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sim = simRef.current;

    // Clear canvas
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Grid
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i < CANVAS_WIDTH; i += 40) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let i = 0; i < CANVAS_HEIGHT; i += 40) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(CANVAS_WIDTH, i);
      ctx.stroke();
    }

    // Threat Zones
    sim.groundAssets.forEach(asset => {
        const gradient = ctx.createRadialGradient(asset.x, asset.y, THREATENING_RANGE - 20, asset.x, asset.y, THREATENING_RANGE);
        gradient.addColorStop(0, 'rgba(239, 68, 68, 0)');
        gradient.addColorStop(1, 'rgba(239, 68, 68, 0.1)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(asset.x, asset.y, THREATENING_RANGE, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(asset.x, asset.y, THREATENING_RANGE, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
    });

    // Destroyed Assets
    sim.destroyedAssets.forEach(asset => {
        ctx.fillStyle = '#1f2937';
        ctx.strokeStyle = '#374151';
        ctx.lineWidth = 2;
        
        ctx.beginPath();
        ctx.moveTo(asset.x - asset.size/2, asset.y + asset.size/2);
        ctx.lineTo(asset.x, asset.y - asset.size/3);
        ctx.lineTo(asset.x + asset.size/2, asset.y + asset.size/2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#4b5563';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText("DESTROYED", asset.x, asset.y + asset.size + 12);
    });

    // Live Assets
    sim.groundAssets.forEach(asset => {
      const colors: { [key: string]: string } = {
        command: '#fbbf24', aa: '#ef4444', radar: '#06b6d4', supply: '#8b5cf6',
        hospital: '#10b981', building: '#6b7280', power: '#f97316', vehicle: '#84cc16',
        armor: '#14b8a6', tower: '#8b5cf6', hangar: '#64748b', fuel: '#dc2626'
      };
      const baseColor = colors[asset.type] || '#4ade80';

      ctx.shadowBlur = 10;
      ctx.shadowColor = baseColor;
      ctx.fillStyle = baseColor;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;

      if (asset.type === 'command' || asset.type === 'tower') {
        ctx.fillRect(asset.x - asset.size/2, asset.y - asset.size/2, asset.size, asset.size);
      } else if (asset.type === 'aa') {
         ctx.beginPath();
         ctx.moveTo(asset.x, asset.y - asset.size);
         ctx.lineTo(asset.x - asset.size, asset.y + asset.size/2);
         ctx.lineTo(asset.x + asset.size, asset.y + asset.size/2);
         ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(asset.x, asset.y, asset.size / 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      
      ctx.shadowBlur = 0;
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(asset.label, asset.x, asset.y + asset.size + 12);

      const hpPct = asset.health / asset.maxHealth;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(asset.x - 15, asset.y - asset.size - 8, 30, 4);
      ctx.fillStyle = hpPct > 0.5 ? '#4ade80' : (hpPct > 0.25 ? '#facc15' : '#ef4444');
      ctx.fillRect(asset.x - 15, asset.y - asset.size - 8, 30 * hpPct, 4);
    });

    // Friendly Drones
    sim.friendlyDrones.forEach(drone => {
        // Trails
        if (drone.trail.length > 1) {
            ctx.beginPath();
            ctx.moveTo(drone.trail[0].x, drone.trail[0].y);
            for (let i = 1; i < drone.trail.length; i++) {
                ctx.lineTo(drone.trail[i].x, drone.trail[i].y);
            }
            ctx.strokeStyle = `rgba(59, 130, 246, 0.3)`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Drone Body
        ctx.fillStyle = drone.isEngaging ? '#60a5fa' : '#3b82f6';
        if (drone.lostCoords) ctx.fillStyle = '#facc15'; // Lost warning color
        
        ctx.shadowBlur = 10;
        ctx.shadowColor = drone.lostCoords ? '#facc15' : '#3b82f6';
        
        if (drone.type === 'bomber') {
            ctx.fillRect(drone.x - 6, drone.y - 6, 12, 12);
        } else {
            ctx.beginPath();
            ctx.arc(drone.x, drone.y, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.shadowBlur = 0;

        // "No Signal" Icon if in autonomous mode or lost
        if (!communication || drone.lostCoords) {
            ctx.fillStyle = '#facc15';
            ctx.font = '10px sans-serif';
            ctx.fillText('!', drone.x + 6, drone.y - 6);
        }

        // Friendly Health
        const maxHP = drone.type === 'bomber' ? 150 : 100;
        const hpPct = drone.health / maxHP;
        if (hpPct < 1) {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(drone.x - 8, drone.y - 12, 16, 2);
            ctx.fillStyle = hpPct > 0.5 ? '#60a5fa' : '#ef4444';
            ctx.fillRect(drone.x - 8, drone.y - 12, 16 * hpPct, 2);
        }

        ctx.fillStyle = '#93c5fd';
        ctx.font = '8px monospace';
        ctx.fillText(drone.id, drone.x, drone.y - 14);

        if (drone.target && drone.isEngaging && Date.now() - drone.lastFired < 100) {
             ctx.strokeStyle = '#fef08a';
             ctx.shadowBlur = 5;
             ctx.shadowColor = '#fef08a';
             ctx.lineWidth = 1.5;
             ctx.beginPath();
             ctx.moveTo(drone.x, drone.y);
             ctx.lineTo(drone.target.x, drone.target.y);
             ctx.stroke();
             ctx.shadowBlur = 0;
        }

        if (drone.jammingTargets.length > 0) {
            ctx.shadowBlur = 8;
            ctx.shadowColor = '#a855f7';
            ctx.strokeStyle = '#d8b4fe';
            ctx.lineWidth = 2;
            
            drone.jammingTargets.forEach(target => {
                ctx.beginPath();
                ctx.moveTo(drone.x, drone.y);
                const segments = 5;
                let curX = drone.x;
                let curY = drone.y;
                const distX = target.x - drone.x;
                const distY = target.y - drone.y;
                for (let i = 1; i < segments; i++) {
                    const t = i / segments;
                    const nextX = drone.x + distX * t + (Math.random() - 0.5) * 15;
                    const nextY = drone.y + distY * t + (Math.random() - 0.5) * 15;
                    ctx.lineTo(nextX, nextY);
                    curX = nextX;
                    curY = nextY;
                }
                ctx.lineTo(target.x, target.y);
                ctx.stroke();
            });
            ctx.shadowBlur = 0;
        }
    });

    // Hostile Drones
    sim.hostileDrones.forEach(drone => {
        if (drone.health > 0) {
             const isJammed = drone.isJammed;
             const glowColor = isJammed ? '#a855f7' : '#ef4444';
             
             ctx.shadowBlur = 8;
             ctx.shadowColor = glowColor;
             ctx.fillStyle = isJammed ? '#c084fc' : '#ef4444'; 
             
             if (drone.type === 'bomber') {
                ctx.fillRect(drone.x - 6, drone.y - 6, 12, 12);
             } else {
                 const jitterX = isJammed ? (Math.random() - 0.5) * 4 : 0;
                 const jitterY = isJammed ? (Math.random() - 0.5) * 4 : 0;
                 ctx.beginPath();
                 ctx.moveTo(drone.x + jitterX + Math.cos(Date.now()/200)*3, drone.y + jitterY - 6);
                 ctx.lineTo(drone.x + jitterX - 5, drone.y + jitterY + 5);
                 ctx.lineTo(drone.x + jitterX + 5, drone.y + jitterY + 5);
                 ctx.fill();
             }
             ctx.shadowBlur = 0;
             
             if (isJammed) {
                 ctx.strokeStyle = '#d8b4fe';
                 ctx.lineWidth = 1;
                 ctx.beginPath();
                 ctx.arc(drone.x, drone.y, 8, 0, Math.PI * 2);
                 ctx.stroke();
             }

             ctx.fillStyle = '#fca5a5';
             ctx.font = '8px monospace';
             ctx.fillText(drone.id, drone.x, drone.y - 10);
             
             const maxHP = drone.type === 'bomber' ? 150 : 100;
             const hpPct = drone.health / maxHP;
             ctx.fillStyle = 'rgba(0,0,0,0.5)';
             ctx.fillRect(drone.x - 6, drone.y + 8, 12, 2);
             ctx.fillStyle = hpPct > 0.5 ? '#4ade80' : '#ef4444';
             ctx.fillRect(drone.x - 6, drone.y + 8, 12 * hpPct, 2);
        }
    });

    // Particles
    ctx.globalCompositeOperation = 'lighter';
    sim.particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'source-over';

    // Overlays
    drawLidarMap(ctx, sim);
    drawRadarDisplay(ctx, sim);
  };

  const updateSimulation = () => {
    const sim = simRef.current;

    setRadarRotation(prev => (prev + 0.05) % (Math.PI * 2));

    const addParticle = (p: Particle) => sim.particles.push(p);

    for (let i = sim.particles.length - 1; i >= 0; i--) {
        const p = sim.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 1;
        p.size *= 0.95;
        if (p.life <= 0) sim.particles.splice(i, 1);
    }
    
    sim.hostileDrones.forEach(h => h.isJammed = false);

    sim.friendlyDrones.forEach(drone => {
      drone.update(sim.friendlyDrones, sim.hostileDrones, sim.groundAssets, communication, jammingEnabled, addParticle, formation);
    });

    sim.hostileDrones.forEach(drone => {
      if (drone.health > 0) {
        drone.update(sim.friendlyDrones, sim.hostileDrones, sim.groundAssets, communication, jammingEnabled, addParticle, formation);
      }
    });

    // Check dead friendlies
    const survivingFriendlies: Drone[] = [];
    sim.friendlyDrones.forEach(d => {
        if (d.health > 0) {
            survivingFriendlies.push(d);
        } else {
            createExplosion(d.x, d.y, '#3b82f6', 1);
            sim.friendlyLosses++;
        }
    });
    sim.friendlyDrones = survivingFriendlies;

    // Check dead assets
    const survivingAssets: Asset[] = [];
    sim.groundAssets.forEach(a => {
        if (a.health > 0) {
            survivingAssets.push(a);
        } else {
            createExplosion(a.x, a.y, '#f59e0b', 2.5);
            sim.destroyedAssets.push(a);
        }
    });
    sim.groundAssets = survivingAssets;

    // Check dead hostiles
    const survivingHostiles: Drone[] = [];
    let eliminatedThisFrame = 0;
    sim.hostileDrones.forEach(d => {
        if (d.health > 0) {
            survivingHostiles.push(d);
        } else {
            createExplosion(d.x, d.y, '#f97316');
            eliminatedThisFrame++;
        }
    });
    sim.hostileDrones = survivingHostiles;

    // Update UI Stats
    if (Date.now() - lastUiUpdate.current > UI_UPDATE_RATE) {
        const engaged = sim.friendlyDrones.filter(d => d.isEngaging).length;
        const threats = sim.hostileDrones.filter(hostile => {
          return sim.groundAssets.some(asset => hostile.calculateDistance(asset) <= THREATENING_RANGE);
        }).length;

        let totalHealth = 0;
        let totalMaxHealth = 0;
        
        sim.groundAssets.forEach(a => { totalHealth += a.health; totalMaxHealth += a.maxHealth; });
        sim.destroyedAssets.forEach(a => { totalHealth += 0; totalMaxHealth += a.maxHealth; });
        
        const integrity = totalMaxHealth > 0 ? Math.round((totalHealth / totalMaxHealth) * 100) : 0;

        const friendlyData = sim.friendlyDrones.map(d => ({
            id: d.id, x: d.x, y: d.y, 
            targetId: d.target?.id || null, 
            health: d.health,
            isEngaging: d.isEngaging,
            isJammed: false,
            type: d.type,
            isLost: !!d.lostCoords
        }));

        const hostileData = sim.hostileDrones.map(d => ({
            id: d.id, x: d.x, y: d.y,
            targetId: null, health: d.health, isEngaging: false,
            isJammed: d.isJammed,
            type: d.type,
            isLost: false
        }));

        setUiData(prev => ({
            stats: {
                engaged,
                threats,
                eliminated: prev.stats.eliminated + eliminatedThisFrame,
                integrity,
                friendlyLosses: sim.friendlyLosses
            },
            friendlyDrones: friendlyData,
            hostileDrones: hostileData
        }));

        lastUiUpdate.current = Date.now();
    } else if (eliminatedThisFrame > 0) {
        setUiData(prev => ({
            ...prev,
            stats: { ...prev.stats, eliminated: prev.stats.eliminated + eliminatedThisFrame }
        }));
    }

    drawSimulation();

    if (isRunning) {
      sim.animationId = requestAnimationFrame(updateSimulation);
    }
  };

  useEffect(() => {
    initSimulation();
    drawSimulation();
  }, [friendlyCount, hostileCount, bomberCount, hostileBomberCount, selectedMap, formation]);

  useEffect(() => {
    if (isRunning) {
      simRef.current.animationId = requestAnimationFrame(updateSimulation);
    } else {
      if (simRef.current.animationId) {
        cancelAnimationFrame(simRef.current.animationId);
      }
    }
    return () => {
      if (simRef.current.animationId) {
        cancelAnimationFrame(simRef.current.animationId);
      }
    };
  }, [isRunning, communication, jammingEnabled]);

  const handleReset = () => {
    setIsRunning(false);
    setUiData({ stats: { engaged: 0, threats: 0, eliminated: 0, integrity: 100, friendlyLosses: 0 }, friendlyDrones: [], hostileDrones: [] });
    initSimulation();
    drawSimulation();
  };

  const getMatrixDistance = (f: DroneData, h: DroneData) => {
      const dx = f.x - h.x;
      const dy = f.y - h.y;
      return Math.round(Math.sqrt(dx*dx + dy*dy));
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-6 bg-gray-900 text-white rounded-xl shadow-2xl border border-gray-800">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
            <Shield className="text-blue-500" />
            SkyGuard
          </h1>
          <p className="text-gray-400">Decentralized protection algorithm with real-time threat prioritization</p>
        </div>
        <div className="flex items-center gap-2 text-sm bg-gray-800 px-4 py-2 rounded-lg border border-gray-700 font-mono">
            <Activity size={16} className={isRunning ? 'text-green-500 animate-pulse' : 'text-red-500'} />
            {isRunning ? 'SYSTEM ACTIVE' : 'SYSTEM STANDBY'}
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-1 mb-4 border border-gray-700 relative overflow-hidden shadow-inner">
         <div className="absolute inset-0 pointer-events-none opacity-10 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] z-10" style={{backgroundSize: "100% 2px, 3px 100%"}}></div>
         
        <div className="flex justify-between items-center p-3 bg-gray-900 border-b border-gray-700">
          <h2 className="text-lg font-semibold flex items-center gap-2 font-mono text-blue-400">
            <Crosshair size={18} />
            MISSION: {mapConfigs[selectedMap].name.toUpperCase()}
          </h2>
          <select
            value={selectedMap}
            onChange={(e) => setSelectedMap(e.target.value)}
            className="bg-gray-800 text-gray-200 border border-gray-600 px-3 py-1 rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none"
            disabled={isRunning}
          >
            {Object.entries(mapConfigs).map(([key, config]) => (
              <option key={key} value={key}>{config.name}</option>
            ))}
          </select>
        </div>
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="w-full h-auto bg-gray-950"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 relative overflow-hidden group">
          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Engaged</div>
          <div className="text-2xl font-bold text-blue-400 font-mono mt-1">{uiData.stats.engaged}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 relative overflow-hidden group">
          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Threats</div>
          <div className="text-2xl font-bold text-red-400 font-mono mt-1">{uiData.stats.threats}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 relative overflow-hidden group">
          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Neutralized</div>
          <div className="text-2xl font-bold text-green-400 font-mono mt-1">{uiData.stats.eliminated}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 relative overflow-hidden group">
           <div className="absolute top-0 right-0 p-2 opacity-10">
               <Skull size={24} />
           </div>
           <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Casualties</div>
           <div className="text-2xl font-bold text-orange-400 font-mono mt-1">{uiData.stats.friendlyLosses}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 relative overflow-hidden group">
           <div className="absolute top-0 right-0 p-2 opacity-10">
               <Home size={24} />
           </div>
           <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Base Integrity</div>
           <div className={`text-2xl font-bold font-mono mt-1 ${uiData.stats.integrity < 50 ? 'text-red-500' : 'text-emerald-400'}`}>
               {uiData.stats.integrity}%
           </div>
        </div>
      </div>

      {/* Feature 2: Bomber Buttons (Top) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex justify-between items-center mb-3">
              <label className="text-sm text-gray-400 font-medium">FRIENDLY BOMBERS</label>
              <span className="text-blue-400 font-mono font-bold">{bomberCount}</span>
            </div>
            <button onClick={() => setBomberCount(b => b+1)} disabled={isRunning} className="w-full p-2 bg-blue-700 hover:bg-blue-600 rounded text-sm font-semibold">Add Bomber (Heavy)</button>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex justify-between items-center mb-3">
              <label className="text-sm text-gray-400 font-medium">HOSTILE BOMBERS</label>
              <span className="text-red-400 font-mono font-bold">{hostileBomberCount}</span>
            </div>
            <button onClick={() => setHostileBomberCount(b => b+1)} disabled={isRunning} className="w-full p-2 bg-red-700 hover:bg-red-600 rounded text-sm font-semibold">Add Bomber (Heavy)</button>
          </div>
      </div>

      {/* Formation Control */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 mb-6">
        <div className="flex justify-between items-center mb-4">
           <label className="text-sm text-gray-400 font-medium flex items-center gap-2">
             <Layout size={16} className="text-blue-500"/> 
             TACTICAL FORMATION
           </label>
           <span className="text-xs text-gray-500 font-mono">DEPLOYMENT PATTERN</span>
        </div>
        <div className="grid grid-cols-5 gap-2">
             {['circle', 'arrowhead', 'spearhead', 'double-file', 'extended-line'].map(f => (
                 <button 
                    key={f}
                    onClick={() => setFormation(f as FormationType)}
                    disabled={isRunning}
                    className={`p-2 rounded text-xs font-bold uppercase transition-all ${
                        formation === f 
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40 border border-blue-500' 
                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600 border border-gray-700'
                    }`}
                 >
                    {f.replace('-', ' ')}
                 </button>
             ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="flex justify-between items-center mb-3">
            <label className="text-sm text-gray-400 font-medium">FRIENDLY SWARM SIZE</label>
            <span className="text-blue-400 font-mono font-bold">{friendlyCount}</span>
          </div>
          <div className="flex gap-2 items-center">
            <button
              onClick={() => setFriendlyCount(Math.max(2, friendlyCount - 1))}
              className="p-2 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors"
              disabled={isRunning}
            >
              <Minus size={16} />
            </button>
            <div className="flex-1 px-2">
                <input
                type="range"
                min="2"
                max="20"
                value={friendlyCount}
                onChange={(e) => setFriendlyCount(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                disabled={isRunning}
                />
            </div>
            <button
              onClick={() => setFriendlyCount(Math.min(20, friendlyCount + 1))}
              className="p-2 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors"
              disabled={isRunning}
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="flex justify-between items-center mb-3">
            <label className="text-sm text-gray-400 font-medium">HOSTILE SWARM SIZE</label>
            <span className="text-red-400 font-mono font-bold">{hostileCount}</span>
          </div>
          <div className="flex gap-2 items-center">
            <button
              onClick={() => setHostileCount(Math.max(1, hostileCount - 1))}
              className="p-2 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors"
              disabled={isRunning}
            >
              <Minus size={16} />
            </button>
            <div className="flex-1 px-2">
                <input
                type="range"
                min="1"
                max="15"
                value={hostileCount}
                onChange={(e) => setHostileCount(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-500"
                disabled={isRunning}
                />
            </div>
            <button
              onClick={() => setHostileCount(Math.min(15, hostileCount + 1))}
              className="p-2 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors"
              disabled={isRunning}
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <label className={`flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-3 cursor-pointer border hover:border-blue-500 transition-colors ${communication ? 'border-blue-500 bg-blue-900/10' : 'border-gray-700'}`}>
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${communication ? 'bg-blue-600' : 'bg-gray-700'}`}>
            <Radio size={20} className="text-white" />
          </div>
          <div className="flex-1">
              <div className="font-semibold text-sm">Swarm Communication</div>
              <div className="text-xs text-gray-400">Share target data & coordinate rescue</div>
          </div>
          <input
            type="checkbox"
            checked={communication}
            onChange={(e) => setCommunication(e.target.checked)}
            className="w-5 h-5 accent-blue-500"
          />
        </label>

        <label className={`flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-3 cursor-pointer border hover:border-purple-500 transition-colors ${jammingEnabled ? 'border-purple-500 bg-purple-900/10' : 'border-gray-700'}`}>
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${jammingEnabled ? 'bg-purple-600' : 'bg-gray-700'}`}>
            {jammingEnabled ? <WifiOff size={20} className="text-white" /> : <Wifi size={20} className="text-white" />}
          </div>
          <div className="flex-1">
              <div className="font-semibold text-sm">Electronic Warfare</div>
              <div className="text-xs text-gray-400">Jam hostile navigation & weapons</div>
          </div>
          <input
            type="checkbox"
            checked={jammingEnabled}
            onChange={(e) => setJammingEnabled(e.target.checked)}
            className="w-5 h-5 accent-purple-500"
          />
        </label>
      </div>

      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setIsRunning(!isRunning)}
          className={`flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-bold transition-all shadow-lg flex-1 ${
              isRunning 
              ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-900/20' 
              : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-900/20'
          }`}
        >
          {isRunning ? <Pause size={20} /> : <Play size={20} />}
          {isRunning ? 'HALT SIMULATION' : 'ENGAGE SYSTEMS'}
        </button>
        <button
          onClick={handleReset}
          className="flex items-center justify-center gap-2 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg font-bold border border-gray-600 transition-all"
        >
          <RotateCcw size={20} />
        </button>
      </div>

      {/* --- TELEMETRY MATRIX DASHBOARD --- */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden mb-6">
          <div className="px-4 py-3 bg-gray-900 border-b border-gray-700 flex justify-between items-center">
              <h3 className="text-sm font-bold text-gray-300 flex items-center gap-2">
                  <Grid size={16} className="text-blue-400" />
                  REAL-TIME DISTANCE TELEMETRY MATRIX
              </h3>
              <div className="text-xs text-gray-500 font-mono">UNIT: METERS</div>
          </div>
          <div className="p-4 overflow-x-auto">
              {uiData.hostileDrones.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 font-mono text-sm">
                      NO HOSTILE SIGNATURES DETECTED
                  </div>
              ) : (
                  <table className="w-full text-xs font-mono border-collapse">
                      <thead>
                          <tr>
                              <th className="p-2 text-left text-gray-500 border-b border-gray-700 bg-gray-900/50 sticky left-0 z-10">
                                  ID
                              </th>
                              {uiData.hostileDrones.map(h => (
                                  <th key={h.id} className={`p-2 text-center border-b border-gray-700 min-w-[50px] ${h.isJammed ? 'text-purple-400' : 'text-red-400'}`}>
                                      {h.id}
                                  </th>
                              ))}
                          </tr>
                      </thead>
                      <tbody>
                          {uiData.friendlyDrones.map(f => (
                              <tr key={f.id} className="hover:bg-gray-700/30 transition-colors">
                                  <td className="p-2 font-bold border-b border-gray-800 bg-gray-900/50 sticky left-0 border-r border-gray-800 flex gap-2 items-center">
                                      <span className={f.isLost ? 'text-yellow-400' : 'text-blue-400'}>{f.id}</span>
                                      {f.isLost && <AlertTriangle size={10} className="text-yellow-400" />}
                                  </td>
                                  {uiData.hostileDrones.map(h => {
                                      const dist = getMatrixDistance(f, h);
                                      let cellClass = "text-gray-600";
                                      let bgClass = "";
                                      
                                      if (h.isJammed && dist < JAMMING_RANGE) {
                                          cellClass = "text-purple-300 font-bold";
                                          bgClass = "bg-purple-900/40";
                                      } else if (dist < FIRING_RANGE) {
                                          cellClass = "text-red-100 font-bold";
                                          bgClass = "bg-red-900/60 animate-pulse";
                                      } else if (dist < THREATENING_RANGE) {
                                          cellClass = "text-yellow-200";
                                          bgClass = "bg-yellow-900/20";
                                      } else if (f.targetId === h.id) {
                                          cellClass = "text-blue-200";
                                          bgClass = "bg-blue-900/20";
                                      }

                                      return (
                                          <td key={`${f.id}-${h.id}`} className={`p-2 text-center border-b border-gray-800 border-r border-gray-800/50 ${cellClass} ${bgClass}`}>
                                              {dist}
                                          </td>
                                      );
                                  })}
                              </tr>
                          ))}
                      </tbody>
                  </table>
              )}
          </div>
      </div>
      
      <div className="flex flex-wrap gap-4 text-xs text-gray-500 font-mono border-t border-gray-800 pt-4">
        <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
            ENGAGED (&lt;50m)
        </div>
        <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span>
            JAMMING (&lt;100m)
        </div>
        <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
            TRACKING (&lt;150m)
        </div>
        <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            FRIENDLY
        </div>
        <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-yellow-400"></span>
            LOST SIGNAL
        </div>
      </div>
    </div>
  );
};
