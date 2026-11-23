using UnbrokenAges.Sim.Core;

namespace UnbrokenAges.Sim.Data;

public enum YieldType : byte
{
    Food = 0,
    Production = 1,
    Gold = 2,
    Science = 3,
    Culture = 4,
    Faith = 5,
}

/// <summary>Value-type bundle of the six yields. Allocation-free; safe to use in hot loops.</summary>
public struct YieldSet : IEquatable<YieldSet>
{
    public const int Count = 6;
    public static readonly YieldType[] All =
    {
        YieldType.Food, YieldType.Production, YieldType.Gold, YieldType.Science, YieldType.Culture, YieldType.Faith,
    };

    public Fx Food, Production, Gold, Science, Culture, Faith;

    public Fx this[YieldType type]
    {
        readonly get => type switch
        {
            YieldType.Food => Food,
            YieldType.Production => Production,
            YieldType.Gold => Gold,
            YieldType.Science => Science,
            YieldType.Culture => Culture,
            YieldType.Faith => Faith,
            _ => Fx.Zero,
        };
        set
        {
            switch (type)
            {
                case YieldType.Food: Food = value; break;
                case YieldType.Production: Production = value; break;
                case YieldType.Gold: Gold = value; break;
                case YieldType.Science: Science = value; break;
                case YieldType.Culture: Culture = value; break;
                case YieldType.Faith: Faith = value; break;
            }
        }
    }

    public static YieldSet Of(YieldType type, Fx amount)
    {
        var y = new YieldSet();
        y[type] = amount;
        return y;
    }

    public void Add(YieldType type, Fx amount) => this[type] += amount;

    public static YieldSet operator +(YieldSet a, YieldSet b) => new()
    {
        Food = a.Food + b.Food, Production = a.Production + b.Production, Gold = a.Gold + b.Gold,
        Science = a.Science + b.Science, Culture = a.Culture + b.Culture, Faith = a.Faith + b.Faith,
    };

    public static YieldSet operator -(YieldSet a, YieldSet b) => new()
    {
        Food = a.Food - b.Food, Production = a.Production - b.Production, Gold = a.Gold - b.Gold,
        Science = a.Science - b.Science, Culture = a.Culture - b.Culture, Faith = a.Faith - b.Faith,
    };

    public static YieldSet operator *(YieldSet a, Fx m) => new()
    {
        Food = a.Food * m, Production = a.Production * m, Gold = a.Gold * m,
        Science = a.Science * m, Culture = a.Culture * m, Faith = a.Faith * m,
    };

    /// <summary>Per-yield multiply: result[i] = a[i] * (1 + percent[i]/100) where percent holds whole percents.</summary>
    public readonly YieldSet ApplyPercent(YieldSet percent)
    {
        var r = new YieldSet();
        foreach (var t in All) r[t] = this[t] + this[t] * percent[t] / 100;
        return r;
    }

    /// <summary>Dot product with weights: used by AI/planner scoring.</summary>
    public readonly Fx Dot(YieldSet weights)
    {
        Fx sum = Fx.Zero;
        foreach (var t in All) sum += this[t] * weights[t];
        return sum;
    }

    public readonly bool IsZero => Food.Raw == 0 && Production.Raw == 0 && Gold.Raw == 0 && Science.Raw == 0 && Culture.Raw == 0 && Faith.Raw == 0;

    public readonly bool Equals(YieldSet o) =>
        Food == o.Food && Production == o.Production && Gold == o.Gold && Science == o.Science && Culture == o.Culture && Faith == o.Faith;

    public override readonly bool Equals(object? obj) => obj is YieldSet y && Equals(y);
    public override readonly int GetHashCode() => HashCode.Combine(Food, Production, Gold, Science, Culture, Faith);

    public override readonly string ToString()
    {
        var parts = new List<string>();
        foreach (var t in All)
            if (this[t].Raw != 0) parts.Add($"{this[t]} {t}");
        return parts.Count == 0 ? "-" : string.Join(", ", parts);
    }
}
