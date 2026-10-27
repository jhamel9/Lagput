// =====================================================================
// NPC MODULE  (script/npc.js)
// ---------------------------------------------------------------------
// Everything NPC-related lives in this file:
//   - NPC_CONFIG        tuning for the companion        (was CONFIG.npc)
//   - COLLISION_CONFIG  player <-> NPC collision tuning (was CONFIG.collision)
//   - cartoon "!" pop SFX (Web Audio synthesis, no audio files)
//   - NPCController     wander / chase / procedural hand-reach / "!" marker
//   - player <-> NPC collision resolution
//   - createNpcSystem() the single entry point used by game.html
//
// PLAY WITH BOT
//   The NPC is cloned ONCE (hidden) when the character finishes loading
//   (prepare). The gear menu's PLAY WITH BOT button calls toggle() to show /
//   hide it. While hidden, nothing about the NPC is updated.
//
// HOW THE PROCEDURAL REACH WORKS
//   1. The right hand bone is found with CONFIG.pickup.handBoneTiers.
//   2. buildArmChain(handBone) gives the forearm / upper arm / shoulder.
//   3. A child "grip point" is attached to the hand (fingertip analysis).
//   4. While chasing and within reachDistance, the IK target is the
//      player's chest and the chain weight fades in / out.
//   5. SimpleIKChain.update() runs AFTER the mixer so IK layers on top.
//   Tuning: raise CONFIG.pickup.ikIterations / lower ikMaxStep if the arm
//   barely moves; add keywords to handBoneTiers if the wrong bone moves.
// =====================================================================
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

/* =====================================================================
   CONFIG
   ===================================================================== */
export const NPC_CONFIG = {
  enabled: false,
  spawnPos: { x: 6, z: -4 },
  wanderRadius: 11,
  idleMin: 1.2, idleMax: 3.2,
  walkMin: 2.5, walkMax: 5.5,

  /* Maximum time the NPC keeps chasing. It only stops when the hand
     tags the player, the body closes in, or the player drops the item. */
  chaseDuration: 20.0,

  /* Procedural hand-reach gesture (driven by the built-in CCD IK). */
  reachDistance: 2.4,
  reachFadeIn: 0.35,
  reachFadeOut: 0.60,
  reachTargetHeightFactor: 0.62,  // fraction of character height (chest)

  /* Distance (metres) at which the reaching hand counts as touching. */
  handContactDistance: 0.15,

  /* Fallback body-to-body tag distance so a chase ALWAYS ends on contact. */
  bodyContactDistance: 0.80,

  /* NATURAL PURSUIT
     reactionTime          seconds of perceptual lag (jukes take this long
                           to register)
     predictionTime        seconds of lead when aiming at the player
     maxPredictionDistance hard cap on that lead offset */
  reactionTime: 0.45,
  predictionTime: 0.55,
  maxPredictionDistance: 3.5,

  /* CARTOON "!" DETECTION MARKER */
  exclaimColor: 0xff2b2b,
  exclaimHeightFactor: 1.05,   // marker height as a multiple of character height
  exclaimSize: 0.455,          // world-space size (metres)
  exclaimDuration: 0.75,       // seconds on screen

  /* Cartoon "pop" SFX (synthesized, no file needed). */
  exclaimSoundEnabled: true,
  exclaimSoundVolume: 0.35,

  /* "Caught!" SFX played when the NPC tags the player (synthesized). */
  caughtSoundEnabled: true,
  caughtSoundVolume: 0.45,

  /* NPC CHARACTER COLORS (same shape as CONFIG.character.colors). */
  colors: {
    enabled: true,
    replaceTextures: false,
    hair:     0x1a1410,   // darker hair
    body:     0xe8b48c,   // same skin tone as the player
    shirt:    0x27ae60,   // green t-shirt
    shorts:   0x6a4c93,   // purple shorts
    slippers: 0xf39c12,   // amber slippers
  },
};

/* SIMPLE PLAYER <-> NPC COLLISION (circle vs circle in the XZ plane). */
export const COLLISION_CONFIG = {
  enabled: true,
  /* Minimum centre-to-centre separation (metres). Kept below
     NPC_CONFIG.bodyContactDistance so the chase tag fires BEFORE the push. */
  playerNpcMinDistance: 0.70,
};

/* =====================================================================
   CARTOON SFX  (Web Audio synthesis, no external files)
   ===================================================================== */
let _audioCtx = null;

function getAudioCtx() {
  if (_audioCtx) return _audioCtx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    _audioCtx = new AC();
  } catch (err) {
    return null;
  }
  return _audioCtx;
}

function unlockAudio() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}
/* Capture phase, so the menu's stopPropagation() can't block the unlock. */
['pointerdown', 'touchstart', 'mousedown', 'keydown', 'click'].forEach((evt) => {
  window.addEventListener(evt, unlockAudio, { passive: true, capture: true });
});

/* Short cartoon "pop!": a quick upward chirp with a snappy envelope. */
function playExclaimPop() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); }

  const t0 = ctx.currentTime;
  const vol = NPC_CONFIG.exclaimSoundVolume;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(680, t0);
  osc.frequency.exponentialRampToValueAtTime(1650, t0 + 0.07);

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0001), t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);

  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.17);

  /* Tiny click transient so the pop reads as a crisp cartoon ding. */
  const clickOsc = ctx.createOscillator();
  const clickGain = ctx.createGain();
  clickOsc.type = 'square';
  clickOsc.frequency.setValueAtTime(2200, t0);
  clickGain.gain.setValueAtTime(0.0001, t0);
  clickGain.gain.exponentialRampToValueAtTime(Math.max(vol * 0.5, 0.0001), t0 + 0.004);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
  clickOsc.connect(clickGain).connect(ctx.destination);
  clickOsc.start(t0);
  clickOsc.stop(t0 + 0.06);
}

/* "Caught!" sting — descending saw zap plus a low sine thud. */
function playCaughtSound() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); }

  const t0 = ctx.currentTime;
  const vol = NPC_CONFIG.caughtSoundVolume;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(880, t0);
  osc.frequency.exponentialRampToValueAtTime(110, t0 + 0.30);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0001), t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.36);

  const thud = ctx.createOscillator();
  const thudGain = ctx.createGain();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(160, t0);
  thud.frequency.exponentialRampToValueAtTime(45, t0 + 0.22);
  thudGain.gain.setValueAtTime(0.0001, t0);
  thudGain.gain.exponentialRampToValueAtTime(Math.max(vol * 0.7, 0.0001), t0 + 0.015);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.30);
  thud.connect(thudGain).connect(ctx.destination);
  thud.start(t0);
  thud.stop(t0 + 0.32);
}

/* =====================================================================
   NPC SYSTEM FACTORY
   ---------------------------------------------------------------------
   game.html passes in the shared helpers the NPC needs (scene, camera,
   toon helpers, IK helpers, angle helpers, safe-zone test).
   ===================================================================== */
export function createNpcSystem(ctx) {
  const {
    CONFIG, scene, camera,
    makeToonMaterial, applyToonGraphics, applyCharacterColors,
    findBone, buildArmChain, computeFingertipLocalOffset, SimpleIKChain,
    lerpAngle, angleDelta, rotateTowardsAngle,
    isPlayerInSafeZone,
  } = ctx;

  /* Keep the familiar CONFIG.npc / CONFIG.collision access paths. */
  CONFIG.npc = NPC_CONFIG;
  CONFIG.collision = COLLISION_CONFIG;

  /* ===================================================================
     NPC CONTROLLER
     - Wanders using the player's idle / run clips (run is time-scaled
       down so it also works as a walk).
     - Sprints at the player while the player holds the item.
     - Procedural CCD-IK hand reach when the player gets close.
     - Cartoon "!" marker with pop SFX when it spots the pickup.
     =================================================================== */
  class NPCController {
    constructor(root, model, clips, info) {
      this.root = root;
      this.model = model;
      this.info = info;

      this.mixer = new THREE.AnimationMixer(model);
      this.actions = {
        idle: this.mixer.clipAction(clips.idle),
        run:  this.mixer.clipAction(clips.run),
      };
      this.actions.idle.setLoop(THREE.LoopRepeat, Infinity);
      this.actions.run.setLoop(THREE.LoopRepeat, Infinity);
      for (const key of Object.keys(this.actions)) {
        const a = this.actions[key];
        a.enabled = true;
        a.setEffectiveTimeScale(1);
        a.setEffectiveWeight(0);
      }
      this.actions.idle.setEffectiveWeight(1);
      this.actions.idle.play();
      this.currentState = 'idle';

      this.facingAngle = Math.random() * Math.PI * 2;
      this.root.rotation.y = this.facingAngle;
      this.horizontalVelocity = new THREE.Vector3();

      this.walkSpeed = CONFIG.movement.walkSpeed * 0.55;
      /* Chase speed matches the player's sprint exactly: no cheating. */
      this.runSpeed  = CONFIG.movement.walkSpeed * CONFIG.movement.runMultiplier;

      this.homeX = root.position.x;
      this.homeZ = root.position.z;
      this.targetPos = new THREE.Vector3(this.homeX, 0, this.homeZ);
      this._pickWanderTarget();

      this.walking = false;
      this.stateTimer = 0;
      this.stateDuration = CONFIG.npc.idleMin + Math.random() * (CONFIG.npc.idleMax - CONFIG.npc.idleMin);

      this.chasing = false;
      this.chaseTimer = 0;

      /* ---- Procedural hand reach rig ---- */
      this.reachIK = null;
      this.reachWeight = 0;
      this._ikTargetWorld = new THREE.Vector3();
      this._handWorld = new THREE.Vector3();

      /* Smoothed chase target (predicted future position, not the exact
         player coordinates), so pursuit reads as a runner, not a teleport. */
      this._chaseTarget = new THREE.Vector3(this.homeX, 0, this.homeZ);
      this._chaseTargetInit = false;

      /* Pursuit state: real player velocity + the delayed copy the NPC uses. */
      this._lastPlayerPos = new THREE.Vector3(this.homeX, 0, this.homeZ);
      this._hasLastPlayerPos = false;
      this._playerVel = new THREE.Vector3();
      this._delayedPlayerPos = new THREE.Vector3(this.homeX, 0, this.homeZ);
      this._delayedPlayerVel = new THREE.Vector3();

      /* Steering is low-passed as an ANGLE (not a vector) so hard jukes
         never snap the facing or pass through a zero-length direction. */
      this._steerAngle = this.facingAngle;

      /* Straightness detector: 1 = player runs straight (NPC steers
         tightly), 0 = player is juking (NPC lags, so cuts work as dodges). */
      this._straightness = 1.0;
      this._lastPlayerVelAngle = 0;
      this._hasPlayerVelAngle = false;

      /* Chase start ramp 0 -> 1 (idle -> walk -> run). */
      this._chaseRamp = 0;

      const handBone = findBone(model, CONFIG.pickup.handBoneTiers);
      const armChain = handBone ? buildArmChain(handBone) : [];
      if (handBone && armChain.length > 0) {
        const gripLocal = computeFingertipLocalOffset(handBone);
        const gripPoint = new THREE.Object3D();
        gripPoint.name = 'NPCGripPoint';
        gripPoint.position.copy(gripLocal);
        handBone.add(gripPoint);
        this.reachIK = new SimpleIKChain(
          gripPoint, armChain,
          CONFIG.pickup.ikIterations, CONFIG.pickup.ikMaxStep
        );
        console.log(`NPC: procedural reach rigged on ${armChain.length} bone(s): ` +
          armChain.map((b) => b.name).join(' -> '));
      } else {
        console.warn('NPC: no arm chain detected, procedural reach disabled.');
      }

      /* ---- Cartoon "!" detection marker ----------------------------
         Front pillar + back pillar (3D echo), front dot + back dot, and
         three spark triangles. Flat extruded shapes in the group's local
         XY plane; the group is billboarded toward the camera in
         _updateExclaim(). Toon outlines come from the scene-wide system. */
      this._exclaimRoot = new THREE.Group();
      this._exclaimRoot.name = 'NPCExclaim';
      this._exclaimRoot.position.y = this.info.height * CONFIG.npc.exclaimHeightFactor;
      this._exclaimRoot.visible = false;

      const T = CONFIG.npc.exclaimSize;
      const exMat = makeToonMaterial({ color: CONFIG.npc.exclaimColor });

      function buildPillarGeo(bottomW, topW, height, depth) {
        const s = new THREE.Shape();
        const bw = bottomW * 0.5;
        const tw = topW * 0.5;
        s.moveTo(-bw, 0);
        s.lineTo(bw, 0);
        s.lineTo(tw, height);
        s.lineTo(-tw, height);
        s.closePath();
        return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
      }

      function buildSparkGeo(size, depth) {
        const s = new THREE.Shape();
        s.moveTo(-size * 0.5, 0);
        s.lineTo(size * 0.5, 0);
        s.lineTo(0, size);
        s.closePath();
        return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
      }

      const plateDepth = T * 0.05;

      const mainPillar = new THREE.Mesh(
        buildPillarGeo(T * 0.16, T * 0.11, T * 0.80, plateDepth),
        exMat
      );
      mainPillar.position.set(T * 0.02, T * 0.20, 0);
      mainPillar.rotation.z = THREE.MathUtils.degToRad(4);
      mainPillar.castShadow = false;
      mainPillar.receiveShadow = false;

      const backPillar = new THREE.Mesh(
        buildPillarGeo(T * 0.15, T * 0.11, T * 0.72, plateDepth),
        exMat
      );
      backPillar.position.set(-T * 0.13, T * 0.28, -T * 0.06);
      backPillar.rotation.z = THREE.MathUtils.degToRad(7);
      backPillar.castShadow = false;
      backPillar.receiveShadow = false;

      const mainDotGeo = new THREE.CylinderGeometry(
        T * 0.075, T * 0.075, plateDepth, 20
      );
      mainDotGeo.rotateX(Math.PI / 2);
      const mainDot = new THREE.Mesh(mainDotGeo, exMat);
      mainDot.position.set(T * 0.02, T * 0.075, 0);
      mainDot.castShadow = false;
      mainDot.receiveShadow = false;

      const backDotGeo = new THREE.CylinderGeometry(
        T * 0.055, T * 0.055, plateDepth, 20
      );
      backDotGeo.rotateX(Math.PI / 2);
      const backDot = new THREE.Mesh(backDotGeo, exMat);
      backDot.position.set(-T * 0.18, T * 0.085, -T * 0.06);
      backDot.castShadow = false;
      backDot.receiveShadow = false;

      const spark1 = new THREE.Mesh(buildSparkGeo(T * 0.13, plateDepth), exMat);
      spark1.position.set(T * 0.16, T * 0.86, 0);
      spark1.rotation.z = THREE.MathUtils.degToRad(35);
      spark1.castShadow = false;
      spark1.receiveShadow = false;

      const spark2 = new THREE.Mesh(buildSparkGeo(T * 0.13, plateDepth), exMat);
      spark2.position.set(T * 0.26, T * 0.98, 0);
      spark2.rotation.z = THREE.MathUtils.degToRad(-5);
      spark2.castShadow = false;
      spark2.receiveShadow = false;

      const spark3 = new THREE.Mesh(buildSparkGeo(T * 0.13, plateDepth), exMat);
      spark3.position.set(T * 0.30, T * 0.80, 0);
      spark3.rotation.z = THREE.MathUtils.degToRad(-55);
      spark3.castShadow = false;
      spark3.receiveShadow = false;

      this._exclaimRoot.add(mainPillar);
      this._exclaimRoot.add(backPillar);
      this._exclaimRoot.add(mainDot);
      this._exclaimRoot.add(backDot);
      this._exclaimRoot.add(spark1);
      this._exclaimRoot.add(spark2);
      this._exclaimRoot.add(spark3);

      this.root.add(this._exclaimRoot);
      /* Belt-and-braces: guarantee the same toon material + black
         outline treatment as every other prop in the scene. */
      applyToonGraphics(this._exclaimRoot);

      this._exclaimActive = false;
      this._exclaimTimer = 0;

      this._dir = new THREE.Vector3();
    }

    _pickWanderTarget() {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * CONFIG.npc.wanderRadius;
      this.targetPos.set(this.homeX + Math.cos(a) * r, 0, this.homeZ + Math.sin(a) * r);
    }

    _crossFadeTo(name, duration) {
      if (this.currentState === name) return;
      if (!this.actions[name]) return;
      const from = this.actions[this.currentState];
      const to = this.actions[name];
      to.enabled = true;
      to.setEffectiveWeight(1);
      to.setEffectiveTimeScale(1);
      to.reset();
      to.play();
      from.crossFadeTo(to, duration, false);
      this.currentState = name;
    }

    /* Back to the spawn point in a clean idle state. Used when the bot is
       switched on / off from the menu. */
    resetToSpawn() {
      const sp = CONFIG.npc.spawnPos;
      this.root.position.set(sp.x, CONFIG.movement.groundY, sp.z);
      this.horizontalVelocity.set(0, 0, 0);

      this.chasing = false;
      this.chaseTimer = 0;
      this._chaseRamp = 0;
      this._chaseTargetInit = false;
      this._hasLastPlayerPos = false;
      this._hasPlayerVelAngle = false;
      this._straightness = 1.0;
      this._steerAngle = this.facingAngle;

      this.reachWeight = 0;
      if (this.reachIK) this.reachIK.weight = 0;
      this._hideExclaim();

      this.walking = false;
      this.stateTimer = 0;
      this.stateDuration = CONFIG.npc.idleMin +
        Math.random() * (CONFIG.npc.idleMax - CONFIG.npc.idleMin);
      this._pickWanderTarget();

      this._crossFadeTo('idle', 0.05);
    }

    /* Called whenever the player performs a successful grab. */
    alertToPlayer() {
      this.chasing = true;
      this.chaseTimer = CONFIG.npc.chaseDuration;
      /* Re-seed every tracker from the player's CURRENT state. */
      this._chaseTargetInit = false;
      this._hasLastPlayerPos = false;
      this._steerAngle = this.facingAngle;
      this._straightness = 1.0;
      this._hasPlayerVelAngle = false;
      this._chaseRamp = 0;
      this._triggerExclaim();
    }

    _triggerExclaim() {
      if (!this._exclaimRoot) return;
      this._exclaimActive = true;
      this._exclaimTimer = 0;
      this._exclaimRoot.scale.setScalar(0.01);
      this._exclaimRoot.visible = true;
      if (CONFIG.npc.exclaimSoundEnabled) playExclaimPop();
    }

    _hideExclaim() {
      if (!this._exclaimRoot) return;
      this._exclaimActive = false;
      this._exclaimTimer = 0;
      this._exclaimRoot.visible = false;
      this._exclaimRoot.scale.setScalar(1);
    }

    /* Pop-in / hold / pop-out + billboard toward the camera. */
    _updateExclaim(delta) {
      if (!this._exclaimRoot || !this._exclaimActive) return;

      this._exclaimTimer += delta;
      const dur = CONFIG.npc.exclaimDuration;
      const popIn = 0.15;
      const popOut = 0.12;

      let scale = 1;
      if (this._exclaimTimer < popIn) {
        /* ease-out-back: overshoots then settles */
        const t = this._exclaimTimer / popIn;
        const c1 = 1.70158;
        const c3 = c1 + 1;
        scale = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      } else if (this._exclaimTimer > dur - popOut) {
        const t = (this._exclaimTimer - (dur - popOut)) / popOut;
        scale = 1 - t * 0.9;
      }
      this._exclaimRoot.scale.setScalar(Math.max(0.001, scale));

      this._exclaimRoot.lookAt(camera.position);

      if (this._exclaimTimer >= dur) {
        this._exclaimActive = false;
        this._exclaimRoot.visible = false;
        this._exclaimRoot.scale.setScalar(1);
      }
    }

    update(delta, player) {
      const cfg = CONFIG.movement;
      let wantMoving = false;
      let speed = this.walkSpeed;
      let targetX = this.targetPos.x;
      let targetZ = this.targetPos.z;

      /* --- Chase state ------------------------------------------------
         Runs ONLY while the player is HOLDING an item and is outside the
         safe zone. It ends when the hand / body tags the player (see
         _updateReach), when the player drops the item, or when the
         player steps into the safe zone. */
      const playerHolding = !!(player && player.heldItem);
      const playerSafe = isPlayerInSafeZone();
      if (this.chasing && playerHolding && !playerSafe) {
        const dt = Math.max(delta, 1e-4);

        /* 1. Estimate the player's real instantaneous velocity. */
        if (!this._hasLastPlayerPos) {
          this._lastPlayerPos.copy(player.root.position);
          this._delayedPlayerPos.copy(player.root.position);
          this._delayedPlayerVel.set(0, 0, 0);
          this._hasLastPlayerPos = true;
        } else {
          this._playerVel.set(
            (player.root.position.x - this._lastPlayerPos.x) / dt,
            0,
            (player.root.position.z - this._lastPlayerPos.z) / dt
          );
          this._lastPlayerPos.copy(player.root.position);
        }

        /* 2. Reaction-time delay: the NPC sees a low-pass-filtered player. */
        const reactRate = 1 / Math.max(CONFIG.npc.reactionTime, 1e-3);
        const reactLerp = 1 - Math.exp(-reactRate * delta);
        this._delayedPlayerPos.x +=
          (player.root.position.x - this._delayedPlayerPos.x) * reactLerp;
        this._delayedPlayerPos.z +=
          (player.root.position.z - this._delayedPlayerPos.z) * reactLerp;
        this._delayedPlayerVel.x +=
          (this._playerVel.x - this._delayedPlayerVel.x) * reactLerp;
        this._delayedPlayerVel.z +=
          (this._playerVel.z - this._delayedPlayerVel.z) * reactLerp;

        /* Straightness detector: steady velocity direction -> 1, jukes -> 0. */
        const playerSpeed = Math.hypot(this._playerVel.x, this._playerVel.z);
        if (playerSpeed > 0.6) {
          const velAngle = Math.atan2(this._playerVel.x, this._playerVel.z);
          if (this._hasPlayerVelAngle) {
            const angChange = Math.abs(angleDelta(this._lastPlayerVelAngle, velAngle));
            const angRate = angChange / Math.max(delta, 1e-4);
            const targetStraight = THREE.MathUtils.clamp(1 - angRate / 3.0, 0, 1);
            const straightLerp = 1 - Math.exp(-6.0 * delta);
            this._straightness += (targetStraight - this._straightness) * straightLerp;
          }
          this._lastPlayerVelAngle = velAngle;
          this._hasPlayerVelAngle = true;
        }

        /* 3. Predictive pursuit: aim ahead, with the lead capped. */
        let leadX = this._delayedPlayerVel.x * CONFIG.npc.predictionTime;
        let leadZ = this._delayedPlayerVel.z * CONFIG.npc.predictionTime;
        const leadLen = Math.hypot(leadX, leadZ);
        const maxLead = CONFIG.npc.maxPredictionDistance;
        if (leadLen > maxLead) {
          const s = maxLead / leadLen;
          leadX *= s;
          leadZ *= s;
        }
        const aimX = this._delayedPlayerPos.x + leadX;
        const aimZ = this._delayedPlayerPos.z + leadZ;

        /* 4. Light low-pass on the aim point (removes micro-jitter). */
        if (!this._chaseTargetInit) {
          this._chaseTarget.set(aimX, 0, aimZ);
          this._chaseTargetInit = true;
        } else {
          const trackLerp = 1 - Math.exp(-6.5 * delta);
          this._chaseTarget.x += (aimX - this._chaseTarget.x) * trackLerp;
          this._chaseTarget.z += (aimZ - this._chaseTarget.z) * trackLerp;
        }
        targetX = this._chaseTarget.x;
        targetZ = this._chaseTarget.z;

        /* Ramp from walking pace to a full sprint over ~0.8 s so the
           animation rolls through idle -> walk -> run. */
        const CHASE_RAMP_TIME = 0.8;
        this._chaseRamp = Math.min(1, this._chaseRamp + delta / CHASE_RAMP_TIME);
        const easedRamp = 1 - Math.pow(1 - this._chaseRamp, 2);
        speed = THREE.MathUtils.lerp(this.walkSpeed, this.runSpeed, easedRamp);

        wantMoving = true;
      } else if (this.chasing && (!playerHolding || playerSafe)) {
        /* Player dropped the item OR stepped into the safe zone. */
        this.chasing = false;
        this._chaseRamp = 0;
        this._chaseTargetInit = false;
        this._hasLastPlayerPos = false;
        this._hideExclaim();
        this._pickWanderTarget();
      }

      /* --- Wander state machine (idle <-> walk) ----------------------- */
      if (!this.chasing) {
        this.stateTimer += delta;
        if (this.walking) {
          const d = Math.hypot(
            this.targetPos.x - this.root.position.x,
            this.targetPos.z - this.root.position.z
          );
          if (d < 0.45 || this.stateTimer > this.stateDuration) {
            this.walking = false;
            this.stateTimer = 0;
            this.stateDuration = CONFIG.npc.idleMin +
              Math.random() * (CONFIG.npc.idleMax - CONFIG.npc.idleMin);
          } else {
            wantMoving = true;
            speed = this.walkSpeed;
            targetX = this.targetPos.x;
            targetZ = this.targetPos.z;
          }
        } else if (this.stateTimer > this.stateDuration) {
          this.walking = true;
          this.stateTimer = 0;
          this.stateDuration = CONFIG.npc.walkMin +
            Math.random() * (CONFIG.npc.walkMax - CONFIG.npc.walkMin);
          this._pickWanderTarget();
          targetX = this.targetPos.x;
          targetZ = this.targetPos.z;
        }
      }

      /* --- Steering + smoothed movement --------------------------------
         Direction to the target is low-passed as an ANGLE so hard
         left <-> right jukes never snap the NPC's facing or velocity. */
      if (wantMoving) {
        this._dir.set(targetX - this.root.position.x, 0, targetZ - this.root.position.z);
        const len = this._dir.length();
        if (len > 1e-4) {
          this._dir.divideScalar(len);
          const rawAngle = Math.atan2(this._dir.x, this._dir.z);

          /* Steer rate: slow while the player jukes, fast on straights. */
          const steerRate = THREE.MathUtils.lerp(6.0, 14.0, this._straightness);
          const angleLerp = 1 - Math.exp(-steerRate * delta);
          this._steerAngle = lerpAngle(this._steerAngle, rawAngle, angleLerp);

          this.facingAngle = rotateTowardsAngle(
            this.facingAngle, this._steerAngle, cfg.rotationSpeed * delta);
        }
        const targetVx = Math.sin(this._steerAngle) * speed;
        const targetVz = Math.cos(this._steerAngle) * speed;
        const lerp = 1 - Math.exp(-cfg.acceleration * delta);
        this.horizontalVelocity.x += (targetVx - this.horizontalVelocity.x) * lerp;
        this.horizontalVelocity.z += (targetVz - this.horizontalVelocity.z) * lerp;
      } else {
        const lerp = 1 - Math.exp(-cfg.deceleration * delta);
        this.horizontalVelocity.x += (0 - this.horizontalVelocity.x) * lerp;
        this.horizontalVelocity.z += (0 - this.horizontalVelocity.z) * lerp;
      }

      this.root.position.x += this.horizontalVelocity.x * delta;
      this.root.position.z += this.horizontalVelocity.z * delta;
      this.root.position.y = cfg.groundY;
      this.root.rotation.y = this.facingAngle;

      /* --- Animation state (idle <-> run, run doubles as walk) -------- */
      const speedNow = Math.hypot(this.horizontalVelocity.x, this.horizontalVelocity.z);
      const moving = speedNow > 0.15;
      this._crossFadeTo(moving ? 'run' : 'idle', 0.28);

      if (this.currentState === 'run') {
        const ref = this.chasing ? this.runSpeed : this.walkSpeed;
        /* Low-end clamp of 0.35 gives a clear walking cadence at the very
           start of a chase, ramping smoothly to full speed. */
        const scale = THREE.MathUtils.clamp(speedNow / Math.max(ref, 0.001), 0.35, 1.6);
        this.actions.run.setEffectiveTimeScale(scale);
      }

      this.mixer.update(delta);

      this._updateExclaim(delta);

      /* Procedural reach runs AFTER the mixer so it layers on top. */
      this._updateReach(delta, player);
    }

    _updateReach(delta, player) {
      if (!this.reachIK || !player) return;

      /* Reach is active while chasing and within reachDistance; it stays
         extended point-blank so the NPC can tag, and relaxes otherwise. */
      let wantReach = false;
      if (this.chasing) {
        const d = Math.hypot(
          player.root.position.x - this.root.position.x,
          player.root.position.z - this.root.position.z
        );
        wantReach = d < CONFIG.npc.reachDistance;
      }

      const target = wantReach ? 1 : 0;
      const rate = (target > this.reachWeight)
        ? 1 / Math.max(CONFIG.npc.reachFadeIn, 1e-3)
        : 1 / Math.max(CONFIG.npc.reachFadeOut, 1e-3);
      if (this.reachWeight < target) {
        this.reachWeight = Math.min(target, this.reachWeight + rate * delta);
      } else if (this.reachWeight > target) {
        this.reachWeight = Math.max(target, this.reachWeight - rate * delta);
      }

      this.reachIK.weight = this.reachWeight;
      if (this.reachWeight <= 0.001) return;

      this.root.updateMatrixWorld(true);
      this._ikTargetWorld.copy(player.root.position);
      this._ikTargetWorld.y += this.info.height * CONFIG.npc.reachTargetHeightFactor;
      this.reachIK.target.copy(this._ikTargetWorld);
      this.reachIK.update();
      this.root.updateMatrixWorld(true);

      /* Contact ends the chase. Two independent checks:
           1. HAND tag: the IK hand effector is on the player's chest.
           2. BODY tag: the NPC root closed to the player's body (fallback
              when the IK can't quite reach, so the chase ALWAYS ends). */
      if (this.chasing) {
        this.reachIK.effector.getWorldPosition(this._handWorld);

        const chestY = player.root.position.y +
          this.info.height * CONFIG.npc.reachTargetHeightFactor;
        const hx = this._handWorld.x - player.root.position.x;
        const hy = this._handWorld.y - chestY;
        const hz = this._handWorld.z - player.root.position.z;
        const handContact = Math.sqrt(hx * hx + hy * hy + hz * hz);

        const bx = this.root.position.x - player.root.position.x;
        const bz = this.root.position.z - player.root.position.z;
        const bodyContact = Math.hypot(bx, bz);

        const tagged =
          (handContact < CONFIG.npc.handContactDistance) ||
          (bodyContact < CONFIG.npc.bodyContactDistance);

        if (tagged) {
          this.chasing = false;
          this.chaseTimer = 0;
          this.reachWeight = 0;
          this.reachIK.weight = 0;
          this._pickWanderTarget();
          if (CONFIG.npc.caughtSoundEnabled) playCaughtSound();
          console.log('NPC: tagged player, chase ended.');
        }
      }
    }
  }

  /* ===================================================================
     SYSTEM STATE + PUBLIC API
     =================================================================== */
  let npc = null;
  let active = false;
  let lastPickedCount = null;

  /* Player <-> NPC collision: two solid bodies of equal mass. The residual
     overlap is split 50/50 along the contact normal and the inward velocity
     of BOTH bodies is cancelled, so neither can push the other around. */
  function resolveCollision(player) {
    if (!CONFIG.collision.enabled) return;
    if (!player || !npc) return;

    const dx = npc.root.position.x - player.root.position.x;
    const dz = npc.root.position.z - player.root.position.z;
    const distSq = dx * dx + dz * dz;
    const minDist = CONFIG.collision.playerNpcMinDistance;

    if (distSq >= minDist * minDist) return;

    let nx, nz, dist;
    if (distSq < 1e-8) {
      nx = 1; nz = 0; dist = 0;
    } else {
      dist = Math.sqrt(distSq);
      nx = dx / dist;
      nz = dz / dist;
    }

    const overlap = minDist - dist;
    const half = overlap * 0.5;
    player.root.position.x -= nx * half;
    player.root.position.z -= nz * half;
    npc.root.position.x    += nx * half;
    npc.root.position.z    += nz * half;

    /* n points from player -> NPC. */
    const pv = player.horizontalVelocity;
    const pInto = pv.x * nx + pv.z * nz;
    if (pInto > 0) {
      pv.x -= pInto * nx;
      pv.z -= pInto * nz;
    }

    const nv = npc.horizontalVelocity;
    const nInto = nv.x * nx + nv.z * nz;
    if (nInto < 0) {
      nv.x -= nInto * nx;
      nv.z -= nInto * nz;
    }
  }

  /* Clone the character ONCE (hidden). Cloning at load time keeps the
     NPC free of anything the player picks up later. */
  function prepare(sourceModel, clips, info) {
    if (npc) return;

    const npcModel = skeletonClone(sourceModel);
    npcModel.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
        o.frustumCulled = false;
      }
    });

    /* Re-tint the clone with the NPC palette so it does not look like a
       copy of the player. */
    applyCharacterColors(npcModel, CONFIG.npc.colors);

    const npcRoot = new THREE.Group();
    npcRoot.name = 'NPCRoot';
    npcRoot.visible = false;
    npcRoot.position.set(
      CONFIG.npc.spawnPos.x,
      CONFIG.movement.groundY,
      CONFIG.npc.spawnPos.z
    );
    npcRoot.add(npcModel);
    scene.add(npcRoot);

    npc = new NPCController(npcRoot, npcModel, clips, info);
    console.log('NPC prepared (hidden until PLAY WITH BOT).');
  }

  function start() {
    if (!npc) return false;
    npc.resetToSpawn();
    npc.root.visible = true;
    active = true;
    lastPickedCount = null;
    unlockAudio();   // the menu click is a user gesture
    console.log('NPC: bot ON.');
    return true;
  }

  function stop() {
    active = false;
    if (!npc) return;
    npc.resetToSpawn();
    npc.root.visible = false;
    console.log('NPC: bot OFF.');
  }

  function toggle() {
    if (!npc) return false;
    if (active) stop();
    else start();
    return active;
  }

  /* Called every frame from game.html. No-op while the bot is off. */
  function update(delta, player, pickedCount) {
    if (!active || !npc || !player) return;

    npc.update(delta, player);

    /* Alert the NPC whenever the player grabs something. The first frame
       only records a baseline, so earlier pickups don't trigger it. */
    if (lastPickedCount === null) lastPickedCount = pickedCount;
    if (pickedCount !== lastPickedCount) {
      lastPickedCount = pickedCount;
      /* Safe zone disables the chase: no alert while inside it. */
      if (!isPlayerInSafeZone()) npc.alertToPlayer();
    }

    /* Final positional authority for the frame. */
    resolveCollision(player);
  }

  return {
    prepare,
    start,
    stop,
    toggle,
    update,
    isReady: () => !!npc,
    isActive: () => active,
  };
}