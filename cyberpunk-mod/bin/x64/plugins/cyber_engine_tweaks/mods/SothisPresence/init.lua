-- Sothis Presence: every few seconds, writes what V is up to into presence.json (next to this file) so the Sothis app
-- on this PC can show it in your Discord status. It only reads the game; it never changes anything, and nothing
-- leaves your PC except through Sothis's own Discord status. Needs Cyber Engine Tweaks.

local SothisPresence = { every = 4, t = 0, inGame = false }

-- everything the game is asked is wrapped, so a game update that renames something only blanks that one detail
local function try(f, ...) local ok, v = pcall(f, ...); if ok then return v end; return nil end

local function esc(s)
  s = tostring(s or "")
  return (s:gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' elseif c == "\\" then return "\\\\" elseif c == "\n" then return "\\n" end
    return string.format("\\u%04x", c:byte())
  end))
end

local function toJson(t)
  local parts = {}
  for k, v in pairs(t) do
    local val
    if type(v) == "boolean" then val = v and "true" or "false"
    elseif type(v) == "number" then val = (v ~= v or v == math.huge or v == -math.huge) and "0" or string.format("%.2f", v):gsub("%.?0+$", "")
    elseif v == nil then val = "null"
    else val = '"' .. esc(v) .. '"' end
    parts[#parts + 1] = '"' .. esc(k) .. '":' .. val
  end
  return "{" .. table.concat(parts, ",") .. "}"
end

local function write(t)
  local f = io.open("presence.json", "w")
  if f then f:write(toJson(t)); f:close() end
end

local function loc(key)
  if not key then return "" end
  local s = try(function() return Game.GetLocalizedText(key) end)
  if s and s ~= "" and s ~= key then return s end
  s = try(function() return GetLocalizedText(key) end)
  return (s and s ~= "") and s or ""
end

local function district(prevention)
  local d = try(function() return prevention.districtManager:GetCurrentDistrict() end)
  if not d then return "", "" end
  local rec = try(function() return TweakDBInterface.GetDistrictRecord(d:GetDistrictID()) end)
  if not rec then return "", "" end
  local name = loc(try(function() return rec:LocalizedName() end))
  local parent = try(function() return rec:ParentDistrict() end)
  local parentName = parent and loc(try(function() return parent:LocalizedName() end)) or ""
  return name or "", parentName or ""
end

local function trackedQuest()
  local jm = try(function() return Game.GetJournalManager() end)
  if not jm then return "" end
  local entry = try(function() return jm:GetTrackedEntry() end)
  if not entry then return "" end
  -- objective → phase → quest
  local quest = entry
  for _ = 1, 4 do
    local p = try(function() return jm:GetParentEntry(quest) end)
    if not p then break end
    quest = p
    if try(function() return quest:IsA("gameJournalQuest") end) then break end
  end
  local title = try(function() return quest:GetTitle(jm) end)
  return loc(title)
end

local function snapshot()
  local player = Game.GetPlayer()
  if not player then return { running = true, inGame = false, at = os.time() } end
  local id = player:GetEntityID()
  local stats = Game.GetStatsSystem()
  local pools = Game.GetStatPoolsSystem()
  local prevention = try(function() return Game.GetScriptableSystemsContainer():Get("PreventionSystem") end)

  local s = { running = true, inGame = true, at = os.time() }
  s.level = try(function() return stats:GetStatValue(id, gamedataStatType.Level) end) or 0
  s.streetCred = try(function() return stats:GetStatValue(id, gamedataStatType.StreetCred) end) or 0
  s.health = try(function() return pools:GetStatPoolValue(id, gamedataStatPoolType.Health, true) end) or 100
  s.money = try(function() return Game.GetTransactionSystem():GetItemQuantity(player, MarketSystem.Money()) end) or 0
  s.lifePath = try(function()
    local lp = PlayerDevelopmentSystem.GetData(player):GetLifePath()
    return ({ [0] = "Nomad", [1] = "Streetkid", [2] = "Corpo" })[EnumInt(lp)] or ""
  end) or ""

  s.district, s.parentDistrict = district(prevention)
  s.wanted = try(function() return EnumInt(prevention:GetHeatStage()) end) or 0
  s.combat = try(function() return player:IsInCombat() end) or false

  local veh = try(function() return Game.GetMountedVehicle(player) end)
  s.vehicle = veh and (try(function() return veh:GetDisplayName() end) or "a car") or ""

  local gt = try(function() return Game.GetTimeSystem():GetGameTime() end)
  s.hour = gt and (try(function() return gt:Hours() end) or 0) or 0
  s.minute = gt and (try(function() return gt:Minutes() end) or 0) or 0
  s.weather = try(function() return NameToString(Game.GetWeatherSystem():GetWeatherState().name) end) or ""
  s.quest = trackedQuest() or ""
  s.paused = try(function() return Game.GetSystemRequestsHandler():IsGamePaused() end) or false
  return s
end

registerForEvent("onInit", function()
  -- in the main menu until a save is loaded
  Observe("QuestTrackerGameController", "OnInitialize", function() SothisPresence.inGame = true end)
  Observe("QuestTrackerGameController", "OnUninitialize", function()
    if Game.GetPlayer() == nil then SothisPresence.inGame = false end
  end)
  write({ running = true, inGame = false, at = os.time() })
end)

registerForEvent("onUpdate", function(dt)
  SothisPresence.t = SothisPresence.t + dt
  if SothisPresence.t < SothisPresence.every then return end
  SothisPresence.t = 0
  local s = try(snapshot) or { running = true, inGame = false, at = os.time() }
  write(s)
end)

registerForEvent("onShutdown", function()
  write({ running = false, at = os.time() })
end)

return SothisPresence
