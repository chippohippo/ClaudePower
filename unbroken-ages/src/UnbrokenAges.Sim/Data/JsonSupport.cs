using System.Text.Json;
using System.Text.Json.Serialization;
using UnbrokenAges.Sim.Core;

namespace UnbrokenAges.Sim.Data;

public static class JsonSupport
{
    /// <summary>
    /// Strict options for game data: unknown properties are errors (catches typos in mods),
    /// comments and trailing commas are allowed so files stay friendly to hand-editing.
    /// </summary>
    public static readonly JsonSerializerOptions DataOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        Converters = { new JsonStringEnumConverter(), new FxJsonConverter(), new YieldSetJsonConverter() },
        WriteIndented = true,
    };

    public static readonly JsonDocumentOptions DocumentOptions = new()
    {
        CommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };
}

public sealed class FxJsonConverter : JsonConverter<Fx>
{
    public override Fx Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.TokenType switch
        {
            JsonTokenType.Number => Fx.FromDecimal(reader.GetDecimal()),
            JsonTokenType.String => Fx.Parse(reader.GetString()!),
            _ => throw new JsonException($"Expected a number, got {reader.TokenType}."),
        };

    public override void Write(Utf8JsonWriter writer, Fx value, JsonSerializerOptions options) =>
        writer.WriteNumberValue(value.ToDecimal());
}

/// <summary>Reads {"food": 2, "production": 1} style objects.</summary>
public sealed class YieldSetJsonConverter : JsonConverter<YieldSet>
{
    public override YieldSet Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.StartObject) throw new JsonException("Yields must be an object.");
        var result = new YieldSet();
        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndObject) return result;
            string name = reader.GetString()!;
            if (!Enum.TryParse<YieldType>(name, ignoreCase: true, out var type))
                throw new JsonException($"Unknown yield '{name}'. Valid: {string.Join(", ", Enum.GetNames<YieldType>())}.");
            reader.Read();
            result[type] = reader.TokenType == JsonTokenType.String ? Fx.Parse(reader.GetString()!) : Fx.FromDecimal(reader.GetDecimal());
        }
        throw new JsonException("Unterminated yields object.");
    }

    public override void Write(Utf8JsonWriter writer, YieldSet value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        foreach (var t in YieldSet.All)
            if (value[t].Raw != 0) writer.WriteNumber(JsonNamingPolicy.CamelCase.ConvertName(t.ToString()), value[t].ToDecimal());
        writer.WriteEndObject();
    }
}
