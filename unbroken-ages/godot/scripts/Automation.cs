using Godot;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client;

/// <summary>
/// Scripted play for testing the real client (CI smoke tests, screenshots, bug repros). Pass user arguments after "--":
///   --autostart[=seed]     start a single-player game at once (Small map, you + 2 AI)
///   --leader=LEADER_X      your leader for --autostart (the AIs get other nations)
///   --do=a,b,c             actions, one every few frames: found, research, produce, end, next, move-east, attack,
///                          panel:T|P|C|V|G|E, save, load, zoom-out, zoom:F, focus-city, focus-ai, lens:resources,
///                          select-city, focus-road, era:N, tech:A+B, path:N, paths, spawn:A+B, wonders:A+B, focus-wonder, focus-camp, reveal (debug), wait
///   --shots=dir            screenshot after every action (dir/NN-action.png)
///   --shot=file.png        screenshot at the end
///   --quit                 exit when done (exit code 1 if an action failed)
/// Example: godot --path godot -- --autostart --do=found,research,produce,end,end --shots=/tmp/ua --quit
/// </summary>
public partial class GameRoot
{
    private readonly Queue<string> _script = new();
    private string? _shotsDir, _finalShot;
    private bool _quitWhenDone, _scripted, _failed;
    private int _waitFrames, _step;

    private void StartAutomation()
    {
        var args = OS.GetCmdlineUserArgs();
        foreach (var a in args)
        {
            if (a.StartsWith("--autostart"))
            {
                ulong seed = a.Contains('=') ? ulong.Parse(a[(a.IndexOf('=') + 1)..]) : 7;
                var size = Db.MapSizes["MAPSIZE_SMALL"];
                // --leader=LEADER_X picks yours; the others get one leader of every other nation.
                string mine = args.FirstOrDefault(x => x.StartsWith("--leader="))?[9..] ?? Db.Leaders[0].Id;
                var others = UI.NationPicker.Opponents(Db, mine, 2, seed);
                var leaders = new List<string> { mine }.Concat(others).ToList();
                StartSinglePlayer(new GameSetup
                {
                    Seed = seed,
                    Map = new MapGenSettings { Width = size.Width, Height = size.Height, GreatRivers = size.GreatRivers, Seed = seed },
                    Players = Enumerable.Range(0, 3).Select(i => new PlayerSetup { Name = i == 0 ? "You" : $"AI {i + 1}", IsHuman = i == 0, Leader = leaders[i % leaders.Count] }).ToList(),
                });
                _scripted = true;
            }
            else if (a.StartsWith("--do=")) foreach (var step in a[5..].Split(',', StringSplitOptions.RemoveEmptyEntries)) _script.Enqueue(step);
            else if (a.StartsWith("--shots=")) _shotsDir = a[8..];
            else if (a.StartsWith("--shot=")) _finalShot = a[7..];
            else if (a == "--quit") _quitWhenDone = true;
        }
        if (_script.Count > 0 || _finalShot != null || _quitWhenDone) { _scripted = true; _waitFrames = 20; }
        if (_shotsDir != null) System.IO.Directory.CreateDirectory(_shotsDir);
    }

    public override void _PhysicsProcess(double delta)
    {
        if (!_scripted || AiBusy || --_waitFrames > 0) return;   // a step waits for the AI's turn to finish
        if (_pendingShot != null) { Shoot(_pendingShot); _pendingShot = null; _waitFrames = 2; return; }
        if (_script.Count > 0)
        {
            string step = _script.Dequeue();
            string? error = RunStep(step);
            GD.Print(error == null ? $"[auto] {step}: ok" : $"[auto] {step}: FAILED: {error}");
            if (error != null) _failed = true;
            _pendingShot = _shotsDir != null ? System.IO.Path.Combine(_shotsDir, $"{++_step:00}-{step.Replace(':', '_')}.png") : null;
            _waitFrames = 12;
            return;
        }
        if (_finalShot != null) { Shoot(_finalShot); _finalShot = null; _waitFrames = 2; return; }
        if (_quitWhenDone) GetTree().Quit(_failed ? 1 : 0);
        _scripted = _quitWhenDone;
    }

    private string? _pendingShot;

    private void Shoot(string path)
    {
        var image = GetViewport().GetTexture().GetImage();
        image.SavePng(path);
        GD.Print($"[auto] screenshot {path}");
    }

    private string? RunStep(string step)
    {
        var s = State;
        if (s == null) return "no game";
        var me = s.Players[LocalPlayer];
        CommandResult Do(GameCommand c) => Submit(c);
        switch (step)
        {
            case "wait": return null;
            case "next": SelectNextUnit(); return SelectedUnit >= 0 ? null : "no unit ready";
            case "found":
            {
                var settler = s.Units.FirstOrDefault(u => u.Owner == LocalPlayer && s.Db.Units[u.DefIndex].FoundsCity);
                if (settler == null) return "no settler";
                SelectUnit(settler.Id);
                return Do(new FoundCityCommand { UnitId = settler.Id }).Error;
            }
            case "research":
            {
                ToggleResearch();
                var tech = s.Db.Techs.Where(t => ResearchSystem.CanResearch(me, t) && !t.Doctrine).OrderBy(t => t.Cost).FirstOrDefault();
                var civic = s.Db.Civics.Where(c => ResearchSystem.CanStudy(me, c)).OrderBy(c => c.Cost).FirstOrDefault();
                if (tech != null) Do(new SetResearchCommand { Tech = tech.Index });
                if (civic != null) Do(new SetCivicCommand { Civic = civic.Index });
                return me.CurrentTech >= 0 ? null : "research not set";
            }
            case "produce":
            {
                var city = s.CitiesOf(LocalPlayer).FirstOrDefault();
                if (city == null) return "no city";
                ClickTile(city.Tile);
                // The Warrior, or the nation's own unit that replaces it (the Medjay, the Hoplite…).
                var warrior = s.Db.Units.First(u => u.Id == "UNIT_WARRIOR");
                var unit = s.Db.Units.FirstOrDefault(u => u.ReplacesIndex == warrior.Index && u.CivilizationIndex == me.CivIndex && me.CivIndex >= 0) ?? warrior;
                return Do(new EnqueueCommand { CityId = city.Id, Kind = ProductionKind.Unit, DefIndex = unit.Index, Repeat = false }).Error;
            }
            case "select-city":
            {
                var city = s.CitiesOf(LocalPlayer).FirstOrDefault();
                if (city == null) return "no city";
                OpenCity(city);
                return null;
            }
            case "end": return Do(new EndTurnCommand()).Error;
            case var many when many.StartsWith("turns:"):
            {
                int n = int.Parse(many[6..]);
                AsyncAiTurns = false;   // many turns in one step: resolve each before the next
                try
                {
                    for (int i = 0; i < n; i++)
                    {
                        // Play like a casual human: keep research, civics and every city's queue busy using the AI's choices.
                        var ai = new UnbrokenAges.Sim.AI.SimpleAi();
                        foreach (var c in ai.TakeTurn(s, LocalPlayer).Where(c => c is SetResearchCommand or SetCivicCommand or EnqueueCommand or FoundCityCommand or MoveUnitCommand or BuildImprovementCommand))
                            Submit(c);
                        var r = Do(new EndTurnCommand());
                        if (!r.Ok) return r.Error;
                    }
                }
                finally { AsyncAiTurns = true; }
                return null;
            }
            case "move-east":
            {
                if (s.GetUnit(SelectedUnit) is not { } u) { SelectNextUnit(); u = s.GetUnit(SelectedUnit)!; if (u == null) return "nothing selected"; }
                int target = u.Tile;
                for (int i = 0; i < 3; i++) { int n = s.Map.Neighbor(target, HexCoord.E); if (n >= 0 && s.Map.IsLand(n)) target = n; }
                OrderSelectedTo(target);
                return null;
            }
            case "save": QuickSave(); return null;
            case "menu": ToggleMenu(); return null;
            case "load": QuickLoad(); return null;
            case "zoom-out": Camera.Zoom(2.2f); return null;
            case var z when z.StartsWith("zoom:"): Camera.Zoom(float.Parse(z[5..], System.Globalization.CultureInfo.InvariantCulture)); return null;
            case var fc when fc is "focus-city" or "focus-ai" || fc.StartsWith("focus-city:"):
            {
                int nth = fc.StartsWith("focus-city:") ? int.Parse(fc[11..]) : 0;
                var city = s.Cities.Where(c => fc.StartsWith("focus-city") ? c.Owner == LocalPlayer : c.Owner != LocalPlayer).OrderByDescending(c => c.Population).ThenBy(c => c.Id).Skip(nth).FirstOrDefault();
                if (city == null) return "no city";
                Camera.LookAtHex(s.Map.CoordOf(city.Tile));
                return null;
            }
            case var e when e.StartsWith("era:"):
            {
                // Debug: every civilization learns all technologies up to an era (to preview late-game visuals).
                int order = int.Parse(e[4..]);
                foreach (var p in s.Players)
                    for (int i = 0; i < s.Db.Techs.Count; i++)
                        if (s.Db.Eras[s.Db.Techs[i].EraIndex].Order <= order) p.Techs[i] = true;
                _localVersion++;
                return null;
            }
            case "lens:resources": ToggleByKey("R"); return null;
            case var pa when pa.StartsWith("path:") || pa == "paths":
            {
                // Debug: research the whole shared tree and commit to a Divergence (path:0 Sovereign, 1 Symbiont, 2 Discarnate
                // for you; "paths" gives every civilization a path in turn) — to preview the futures.
                var order = new[] { "SOVEREIGN", "SYMBIONT", "DISCARNATE" };
                for (int pi = 0; pi < s.Players.Count; pi++)
                {
                    if (pa != "paths" && pi != LocalPlayer) continue;
                    var pl = s.Players[pi];
                    int which = pa == "paths" ? pi % 3 : int.Parse(pa[5..]);
                    int div = s.Db.Divergences.ToList().FindIndex(d => d.Id.Contains(order[which]));
                    if (div < 0) return "no such divergence";
                    for (int i = 0; i < s.Db.Techs.Count; i++)
                        if (s.Db.Techs[i].DivergenceIndex < 0 || s.Db.Techs[i].DivergenceIndex == div) pl.Techs[i] = true;
                    pl.Divergence = div;
                    pl.DivergenceTurn = s.Turn;
                }
                _localVersion++;
                return null;
            }
            case var te when te.StartsWith("tech:"):
            {
                // Debug: research exactly these technologies for every civilization (tech:MASONRY+ENGINEERING).
                foreach (var id in te[5..].Split('+'))
                {
                    int i = s.Db.Techs.IndexOf("TECH_" + id.ToUpperInvariant());
                    if (i < 0) return $"no tech {id}";
                    foreach (var p in s.Players) p.Techs[i] = true;
                }
                _localVersion++;
                return null;
            }
            case "reveal":
                Array.Fill(me.Revealed, true);
                _localVersion++;
                return null;
            case var fr when fr.StartsWith("focus-res:"):
            {
                // Debug: look at the first tile with this resource (e.g. focus-res:CATTLE), visible to you first.
                string id = "RESOURCE_" + fr[10..].ToUpperInvariant();
                var vis = VisibilitySystem.Visible(s, LocalPlayer);
                int tile = Enumerable.Range(0, s.Map.Count).Where(t => s.Map.Resource[t] >= 0 && s.Db.Resources[s.Map.Resource[t]].Id == id)
                                     .OrderByDescending(t => vis[t]).ThenByDescending(t => me.Revealed[t]).DefaultIfEmpty(-1).First();
                if (tile < 0) return "no such resource";
                Camera.LookAtHex(s.Map.CoordOf(tile));
                return null;
            }
            case var wd when wd.StartsWith("wonders:"):
            {
                // Debug: raise the given world wonders (WONDER_ ids without the prefix, joined by '+') around your largest city.
                var city = s.Cities.Where(c => c.Owner == LocalPlayer).OrderByDescending(c => c.Population).ThenBy(c => c.Id).FirstOrDefault();
                if (city == null) return "no city";
                foreach (var id in wd[8..].Split('+'))
                {
                    int def = s.Db.Districts.IndexOf("WONDER_" + id.ToUpperInvariant());
                    if (def < 0) return $"no wonder {id}";
                    int tile = UnbrokenAges.Sim.Systems.Districts.DistrictPlacement.CandidateTiles(s, city)
                        .Where(t => UnbrokenAges.Sim.Systems.Districts.DistrictPlacement.Check(s, city, def, t, new(IgnoreTech: true)).Count == 0)
                        .OrderBy(t => s.Map.Distance(t, city.Tile)).ThenBy(t => t).DefaultIfEmpty(-1).First();
                    if (tile >= 0) CitySystem.AddDistrict(s, city, def, tile);
                }
                _localVersion++;
                return null;
            }
            case "focus-wonder" or "focus-camp":
            {
                // Debug: look at the nearest natural wonder (or barbarian camp) to your capital, revealing it.
                var home = s.Cities.Where(c => c.Owner == LocalPlayer).Select(c => c.Tile).DefaultIfEmpty(0).First();
                var tiles = step == "focus-camp" ? s.Camps.Select(c => c.Tile).ToList()
                          : Enumerable.Range(0, s.Map.Count).Where(t => s.Map.Feature[t] >= 0 && s.Db.Features[s.Map.Feature[t]].NaturalWonder).ToList();
                if (tiles.Count == 0) return "none on this map";
                int tile = tiles.OrderBy(t => s.Map.Distance(t, home)).First();
                var around = new List<int>();
                s.Map.CollectRadius(tile, 3, around);
                foreach (int t in around) me.Revealed[t] = true;
                Camera.LookAtHex(s.Map.CoordOf(tile));
                _localVersion++;
                return null;
            }
            case var sp when sp.StartsWith("spawn:"):
            {
                // Debug: place units of the given types (comma-free list joined by '+') around your capital, one per tile.
                var city = s.Cities.Where(c => c.Owner == LocalPlayer).OrderByDescending(c => c.Population).ThenBy(c => c.Id).FirstOrDefault();
                if (city == null) return "no city";
                var ring = Enumerable.Range(0, 6).Select(d => s.Map.Neighbor(city.Tile, d)).Where(n => n >= 0).ToList();
                foreach (var id in sp[6..].Split('+'))
                {
                    int def = s.Db.Units.IndexOf("UNIT_" + id.ToUpperInvariant());
                    if (def < 0) return $"no unit {id}";
                    var d = s.Db.Units[def];
                    var tiles = ring.Where(t => d.Domain == UnitDomain.Naval ? s.Map.IsWater(t) : s.Map.IsLand(t) && !s.Map.IsMountain(t)).ToList();
                    if (tiles.Count == 0) continue;
                    int tile = tiles.OrderBy(t => s.Units.Count(x => x.Tile == t)).First();
                    s.AddUnit(new UnitState { Id = s.AllocateId(), Owner = LocalPlayer, DefIndex = def, Tile = tile, MovesLeft = d.Moves });
                }
                _localVersion++;
                return null;
            }
            case var gr when gr.StartsWith("grow:"):
            {
                // Debug: set every city's population (to preview how towns fill out).
                int pop = int.Parse(gr[5..]);
                foreach (var c in s.Cities) c.Population = pop;
                _localVersion++;
                return null;
            }
            case var ln when ln.StartsWith("lineup:"):
            {
                // Debug: one of each given unit (UNIT_ ids without the prefix, joined by '+'; "lineup:all" for every military unit)
                // on its own tile around your capital, nearest first, so their looks can be compared side by side.
                var city = s.Cities.Where(c => c.Owner == LocalPlayer).OrderByDescending(c => c.Population).ThenBy(c => c.Id).FirstOrDefault();
                if (city == null) return "no city";
                var area = new List<int>();
                s.Map.CollectRadius(city.Tile, 4, area);
                area = area.Where(t => t != city.Tile).OrderBy(t => s.Map.Distance(t, city.Tile)).ThenBy(t => t).ToList();
                var ids = ln[7..] == "all" ? s.Db.Units.Where(x => x.Strength > 0).Select(x => x.Id).ToList()
                        : ln[7..].Split('+').Select(x => x.StartsWith("UNIT_") ? x : "UNIT_" + x.ToUpperInvariant()).ToList();
                var used = new HashSet<int>(s.Units.Select(x => x.Tile));
                foreach (var id in ids)
                {
                    int def = s.Db.Units.IndexOf(id);
                    if (def < 0) return $"no unit {id}";
                    var d = s.Db.Units[def];
                    int tile = area.FirstOrDefault(t => !used.Contains(t) && (d.Domain == UnitDomain.Naval ? s.Map.IsWater(t) : s.Map.IsLand(t) && !s.Map.IsMountain(t)), -1);
                    if (tile < 0) continue;
                    used.Add(tile);
                    me.Revealed[tile] = true;
                    s.AddUnit(new UnitState { Id = s.AllocateId(), Owner = LocalPlayer, DefIndex = def, Tile = tile, MovesLeft = d.Moves });
                }
                foreach (int t in area) me.Revealed[t] = true;
                _localVersion++;
                return null;
            }
            case var ms when ms.StartsWith("model-sheet:"):
            {
                // Debug: a contact sheet of models (paths under assets/models joined by '+', or a folder name for all of it),
                // each fitted to one unit and labelled, on a plain floor far from the map; prints each model's animations.
                var arg = ms[12..];
                var names = arg.Contains('/') ? arg.Split('+').ToList()
                          : DirAccess.GetFilesAt($"res://assets/models/{arg}").Where(f => f.EndsWith(".glb")).Select(f => $"{arg}/{f[..^4]}").OrderBy(f => f).ToList();
                var sheet = new Node3D { Name = "ModelSheet", Position = new Vector3(0, 200, 0) };
                AddChild(sheet);
                sheet.AddChild(new MeshInstance3D { Mesh = new PlaneMesh { Size = new Vector2(80, 80) }, MaterialOverride = new StandardMaterial3D { AlbedoColor = new Color(0.55f, 0.6f, 0.5f) } });
                int cols = Math.Max(4, (int)Math.Ceiling(Math.Sqrt(names.Count * 1.6)));
                for (int i = 0; i < names.Count; i++)
                {
                    var scene = MapView.Models.LoadScene(names[i]);
                    if (scene == null) continue;
                    var bounds = MapView.Models.SceneBounds(names[i]);
                    float extent = Mathf.Max(bounds.Size.Y, Mathf.Max(bounds.Size.X, bounds.Size.Z));
                    float k = extent > 0.001f ? 1.2f / extent : 1f;
                    var fig = scene.Instantiate<Node3D>();
                    fig.Scale = Vector3.One * k;
                    var cell = new Node3D { Position = new Vector3((i % cols - cols / 2f) * 1.9f, 0, (i / cols) * 1.9f) };
                    fig.Position = -new Vector3(bounds.Position.X + bounds.Size.X / 2, bounds.Position.Y, bounds.Position.Z + bounds.Size.Z / 2) * k;
                    cell.AddChild(fig);
                    cell.AddChild(new Label3D { Text = names[i][(names[i].IndexOf('/') + 1)..], FontSize = 48, PixelSize = 0.005f, Position = new Vector3(0, 0.05f, 0.8f), RotationDegrees = new Vector3(-60, 0, 0), Modulate = Colors.Black, OutlineSize = 0 });
                    sheet.AddChild(cell);
                    var anims = fig.FindChildren("*", "AnimationPlayer", true, false).OfType<AnimationPlayer>().SelectMany(ap => ap.GetAnimationList()).ToList();
                    GD.Print($"[sheet] {names[i]} size {bounds.Size} anims {anims.Count}: {string.Join(",", anims.Take(14))}");
                    bool idled = false;
                    foreach (var ap in fig.FindChildren("*", "AnimationPlayer", true, false).OfType<AnimationPlayer>())
                        if (ap.GetAnimationList().FirstOrDefault(n => n.Contains("Idle", StringComparison.OrdinalIgnoreCase)) is { } idle) { ap.Play(idle); idled = true; }
                    if (!idled) UnbrokenAges.Client.Visuals.UnitLayer.RestArms(fig);
                }
                int rows = (names.Count + cols - 1) / cols;
                var cam = new Camera3D { Fov = 40 };
                sheet.AddChild(cam);
                float span = Math.Max(cols * 1.9f, rows * 1.9f * 1.6f);
                cam.Position = new Vector3(0, span * 0.62f, rows * 1.9f / 2f + span * 0.7f);
                cam.LookAt(sheet.GlobalPosition + new Vector3(0, 0, rows * 1.9f / 2f - 0.6f));
                cam.MakeCurrent();
                return null;
            }
            case var pv when pv.StartsWith("route:"):
            {
                // Debug: preview the selected unit's route to the tile N steps east (as hovering would).
                if (s.GetUnit(SelectedUnit) is not { } u) return "nothing selected";
                var c = s.Map.CoordOf(u.Tile);
                int tile = s.Map.IndexOf(new UnbrokenAges.Sim.Core.HexCoord(c.Q + int.Parse(pv[6..]), c.R));
                MapView.PreviewPath(s, u, tile, LocalPlayer);
                Camera.LookAtHex(c);
                return null;
            }
            case "focus-last":
            {
                var u = s.Units.Where(x => x.Owner == LocalPlayer).OrderByDescending(x => x.Id).FirstOrDefault();
                if (u == null) return "no unit";
                Camera.LookAtHex(s.Map.CoordOf(u.Tile));
                return null;
            }
            case "debug-life": GD.Print("[life] " + MapView.Life.Describe()); return null;
            case "focus-road":
            {
                var road = MapView.Life.Roads.OrderByDescending(r => r.Length).FirstOrDefault();
                if (road == null) return "no road";
                Camera.LookAtHex(UnbrokenAges.Client.Map.HexLayout.FromWorld(road[road.Length / 2]));
                return null;
            }
            default:
                if (step.StartsWith("panel:")) { TogglePanel(step[6..]); return null; }
                return $"unknown step '{step}'";
        }
    }
}
