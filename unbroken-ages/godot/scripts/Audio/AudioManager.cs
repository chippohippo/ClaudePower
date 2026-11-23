using Godot;

namespace UnbrokenAges.Client.Audio;

/// <summary>
/// Sound for the whole client.
/// <list type="bullet">
/// <item><b>Music</b>: a shuffled playlist of period pieces (incompetech.com and OpenGameArt, credited in assets/CREDITS.md)
///   with a slow crossfade between tracks and a few seconds of silence, so it accompanies rather than loops.</item>
/// <item><b>Effects</b>: Kenney CC0 one-shots with slight pitch variation so repeats never sound mechanical; every button
///   in the interface clicks.</item>
/// <item><b>Ambience</b>: wind and distant surf synthesised in real time (no samples), louder over the sea.</item>
/// </list>
/// Buses: Music, SFX, Ambience (volumes in the Esc menu, remembered in user://audio.cfg).
/// </summary>
public partial class AudioManager : Node
{
    private static readonly string[] Playlist =
    {
        "thatched_villagers", "lord_of_the_land", "folk_round", "achaidh_cheide", "the_britons",
        "celtic_impulse", "heroic_age", "tale_on_the_late", "crusade", "prelude_and_action",
    };

    private readonly Dictionary<string, AudioStream?> _sfx = new();
    private readonly List<AudioStreamPlayer> _voices = new();
    private AudioStreamPlayer _musicA = null!, _musicB = null!;
    private bool _aActive = true;
    private readonly List<string> _queue = new();
    private readonly RandomNumberGenerator _rng = new();
    private Ambience _ambience = null!;
    public static AudioManager? Instance { get; private set; }

    public override void _Ready()
    {
        Instance = this;
        LoadVolumes();
        _musicA = new AudioStreamPlayer { Bus = "Music" };
        _musicB = new AudioStreamPlayer { Bus = "Music" };
        AddChild(_musicA);
        AddChild(_musicB);
        _musicA.Finished += () => GetTree().CreateTimer(4.0).Timeout += NextTrack;
        _musicB.Finished += () => GetTree().CreateTimer(4.0).Timeout += NextTrack;
        for (int i = 0; i < 8; i++)
        {
            var p = new AudioStreamPlayer { Bus = "SFX" };
            AddChild(p);
            _voices.Add(p);
        }
        _ambience = new Ambience();
        AddChild(_ambience);
        GetTree().NodeAdded += OnNodeAdded;
    }

    public void StartMusic()
    {
        if (_musicA.Playing || _musicB.Playing) return;
        NextTrack();
    }

    private void NextTrack()
    {
        if (_queue.Count == 0)
        {
            _queue.AddRange(Playlist.OrderBy(_ => _rng.Randi()));
        }
        string name = _queue[0];
        _queue.RemoveAt(0);
        var stream = GD.Load<AudioStream>($"res://assets/audio/music/{name}.ogg");
        if (stream is AudioStreamOggVorbis ogg) ogg.Loop = false;
        var (incoming, outgoing) = _aActive ? (_musicB, _musicA) : (_musicA, _musicB);
        _aActive = !_aActive;
        incoming.Stream = stream;
        incoming.VolumeDb = -40;
        incoming.Play();
        var fade = CreateTween();
        fade.TweenProperty(incoming, "volume_db", 0f, 6.0);
        if (outgoing.Playing) fade.Parallel().TweenProperty(outgoing, "volume_db", -40f, 6.0);
    }

    /// <summary>Plays a named effect from assets/audio/sfx with ±6% pitch variation.</summary>
    public void Play(string name, float volumeDb = 0f, float pitch = 1f)
    {
        if (!_sfx.TryGetValue(name, out var stream))
        {
            string path = $"res://assets/audio/sfx/{name}.ogg";
            _sfx[name] = stream = ResourceLoader.Exists(path) ? GD.Load<AudioStream>(path) : null;
        }
        if (stream == null) return;
        var voice = _voices.FirstOrDefault(v => !v.Playing) ?? _voices[0];
        voice.Stream = stream;
        voice.VolumeDb = volumeDb;
        voice.PitchScale = pitch * _rng.RandfRange(0.94f, 1.06f);
        voice.Play();
    }

    public static void Sfx(string name, float volumeDb = 0f, float pitch = 1f) => Instance?.Play(name, volumeDb, pitch);

    /// <summary>How much open water is in view (0..1): the surf rises over the sea.</summary>
    public void SetSeaShare(float share) => _ambience.SeaShare = share;

    private void OnNodeAdded(Node node)
    {
        if (node is BaseButton button)
        {
            button.Pressed += () => Play(button is CheckBox ? "toggle" : "click", -4f);
            button.MouseEntered += () => { if (!button.Disabled) Play("hover", -20f, 1.2f); };
        }
    }

    private const string ConfigPath = "user://audio.cfg";

    public static void SaveVolumes()
    {
        var cfg = new ConfigFile();
        foreach (var bus in new[] { "Music", "SFX", "Ambience" })
        {
            int i = AudioServer.GetBusIndex(bus);
            if (i >= 0) cfg.SetValue("volume", bus, AudioServer.GetBusVolumeDb(i));
        }
        cfg.Save(ConfigPath);
    }

    private static void LoadVolumes()
    {
        var cfg = new ConfigFile();
        if (cfg.Load(ConfigPath) != Error.Ok) return;
        foreach (var bus in new[] { "Music", "SFX", "Ambience" })
        {
            int i = AudioServer.GetBusIndex(bus);
            if (i >= 0 && cfg.HasSectionKey("volume", bus)) AudioServer.SetBusVolumeDb(i, (float)cfg.GetValue("volume", bus));
        }
    }
}

/// <summary>
/// Real-time ambience, generated rather than sampled: wind is low-passed noise with slow gusts, surf is deeper noise
/// swelling every few seconds like waves on a shore. Original to this project (no third-party audio).
/// </summary>
public partial class Ambience : AudioStreamPlayer
{
    private AudioStreamGeneratorPlayback? _playback;
    private float _wind, _surf, _gustPhase, _wavePhase, _sea;
    private readonly RandomNumberGenerator _rng = new();
    public float SeaShare { get; set; }
    private const float Rate = 22050f;

    public override void _Ready()
    {
        Bus = "Ambience";
        Stream = new AudioStreamGenerator { MixRate = Rate, BufferLength = 0.5f };
        Play();
        _playback = GetStreamPlayback() as AudioStreamGeneratorPlayback;
    }

    public override void _Process(double delta)
    {
        if (_playback == null) return;
        _sea += (SeaShare - _sea) * 0.02f;
        int frames = _playback.GetFramesAvailable();
        for (int i = 0; i < frames; i++)
        {
            float n = _rng.Randf() * 2f - 1f;
            _wind += (n - _wind) * 0.02f;                       // gentle low-pass: a breeze, not hiss
            _surf += (n - _surf) * 0.006f;                      // deeper rumble
            _gustPhase += 0.08f / Rate;
            _wavePhase += 0.12f / Rate;
            float gust = 0.55f + 0.45f * Mathf.Sin(_gustPhase * Mathf.Tau) * Mathf.Sin(_gustPhase * 2.7f);
            float wave = Mathf.Pow(Mathf.Max(0f, Mathf.Sin(_wavePhase * Mathf.Tau)), 3f);
            float sample = _wind * 0.9f * gust + _surf * 3.2f * (0.25f + wave) * (0.2f + _sea);
            _playback.PushFrame(new Vector2(sample, sample * 0.96f));
        }
    }
}
