import { MapSchema, Schema, type } from "@colyseus/schema";

export class PlayerS extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("string") lineage = "pyra";
  @type("string") evolution = "";
  @type("uint8") level = 1;
  @type("boolean") mastery = false;
  @type("boolean") ready = false;
  @type("boolean") connected = true;
  @type("string") life = "alive";
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") fx = 1;
  @type("float32") fy = 0;
  @type("int16") hp = 0;
  @type("int16") maxHp = 0;
  @type("int16") shield = 0;
  @type("float32") downT = 0;
  @type("float32") revive = 0;
  @type("float32") od = 0;
  @type("float32") odT = 0;
  @type("float32") cdDodge = 0;
  @type("float32") cdS1 = 0;
  @type("float32") cdS2 = 0;
  @type("float32") maxS1 = 1;
  @type("float32") maxS2 = 1;
  @type("boolean") hasSkill2 = false;
  @type("boolean") hasOverdrive = false;
  @type("string") act = ""; // "", "windup", "dash", "brace"
  @type("uint8") combo = 0;
  @type("uint32") ack = 0;
  @type("float32") empower = 0;
  @type("uint8") tierUnlocked = 1;
  @type("string") auraRarity = "";
  @type("string") weaponRarity = "";
  @type("uint16") gear = 0;
  @type("boolean") dailyDone = false; // already claimed today's daily-challenge box
}

export class EnemyS extends Schema {
  @type("string") id = "";
  @type("string") kind = "";
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") fx = -1;
  @type("float32") fy = 0;
  @type("int32") hp = 0;
  @type("int32") maxHp = 0;
  @type("string") state = "idle";
  @type("string") atk = "";
  @type("float32") ang = 0;
  @type("float32") t = 0;
  @type("uint8") heat = 0;
  @type("uint8") chill = 0;
  @type("boolean") broken = false;
  @type("uint8") phase = 1;
  @type("float32") stagger = 0; // 0..1 of threshold (boss bar)
  @type("string") elite = "";
  @type("string") variant = "";
}

export class HazardS extends Schema {
  @type("string") id = "";
  @type("string") kind = "";
  @type("string") side = "";
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") r = 0;
  @type("float32") delay = 0;
  @type("float32") life = 0;
  @type("float32") ang = 0;
  @type("float32") len = 0;
}

export class PickupS extends Schema {
  @type("string") id = "";
  @type("float32") x = 0;
  @type("float32") y = 0;
}

export class GameState extends Schema {
  @type("string") phase = "lobby";
  @type("string") code = "";
  @type("string") leaderId = "";
  @type("uint8") tier = 1;
  @type("string") mission = "brood";
  @type("boolean") daily = false;
  @type("string") dailyMutator = "";
  @type("string") runId = "";
  @type("string") stage = "";
  @type("uint8") section = 1;
  @type("float32") maxX = 0;
  @type("float32") objective = 0;
  @type("string") bossId = "";
  @type("uint8") partySize = 0;
  @type("uint16") queued = 0;
  @type("float32") time = 0;
  @type("string") notice = "";
  @type({ map: PlayerS }) players = new MapSchema<PlayerS>();
  @type({ map: EnemyS }) enemies = new MapSchema<EnemyS>();
  @type({ map: HazardS }) hazards = new MapSchema<HazardS>();
  @type({ map: PickupS }) pickups = new MapSchema<PickupS>();
}
