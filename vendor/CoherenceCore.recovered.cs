// RECOVERED SOURCE - decompiled (ILSpy 8.2) from the deployed AimForge.dll on 2026-10-11, because the
// CoherenceStabilizer project is not in this repository. Used ONLY by build.sh when ../CoherenceStabilizer/src is
// absent (cloud selftests). The Windows build.ps1 still compiles the real ../CoherenceStabilizer/src/CoherenceCore.cs.
// Never edit this file: change the stabilizer in its own project, rebuild, and re-extract.
using System;
using System.Numerics;
using System.Runtime.CompilerServices;

namespace CoherenceStabilizer;

public sealed class CoherenceCore
{
	public double TremorWindowMs = 80.0;

	public double HoldTimeMs = 180.0;

	public double FullPassSpeed = 20.0;

	public double EngageSpeed = 3.0;

	public double CoherenceFloor = 0.4;

	public double CoherenceCeiling = 0.6;

	public double MaxLag = 1.0;

	public double ResetMs = 50.0;

	public double RailStrength;

	public double AnchorStrength;

	public double AnchorTimeMs = 350.0;

	public double SettleAssist;

	public double TapAnchor;

	public double TapArmPressure = 0.01;

	public double TapHoldMs = 45.0;

	public double TapBreakMm = 1.2;

	public double TapMoveFade;

	public double LeadMs;

	public double LeadMaxMm = 1.5;

	private const double AnchorDepth = 1.5;

	private const double AnchorCoherenceBias = 0.15;

	private const double SettleDecayMs = 120.0;

	private const double MaxRailTauMs = 45.0;

	public double SettleFlickSpeed = 80.0;

	private const double SpeedEmaMs = 12.0;

	private const double DenormalFloor = 1E-18;

	private const double TapPreRollMs = 24.0;

	private const double TapBreakSpeed = 150.0;

	private const double TapMaxMs = 600.0;

	private const double TapRecoverMs = 50.0;

	private const double TapRewindMaxMm = 0.45;

	private const double TapRewindFreeSpeed = 20.0;

	private const double TapRewindNoneSpeed = 70.0;

	private const double TapRestSpeed = 12.0;

	private const double TapMoveSpeed = 30.0;

	private const double TapPressLookMs = 40.0;

	private const double TapBreakRecoverMs = 8.0;

	private const double TapDisarmFrac = 0.5;

	public double LeadDecelFull = 0.95;

	public double LeadDecelNone = 0.55;

	public double LeadMinSpeed = 8.0;

	public double LeadFullSpeed = 30.0;

	private Vector2 lastPos;

	private Vector2 outPos;

	private Vector2 vecEma;

	private double magEma;

	private double speedEma;

	private double coherence = 1.0;

	private double dwellMs;

	private double settleBoost;

	private double prevSpeed;

	private bool primed;

	private readonly Vector2[] history = (Vector2[])(object)new Vector2[64];

	private readonly double[] historyAge = new double[64];

	private int historyAt = -1;

	private Vector2 anchorPos;

	private double tapMs;

	private double tapSinceRelease;

	private double tapBlend;

	private double tapFadeMs = 50.0;

	private bool tapArmed;

	private bool tapHolding;

	private bool tapBroken;

	private double tapStrength = 1.0;

	private double prevPressure;

	private double speedPreReport;

	private double hoverSpeedEma;

	private double pressedMs;

	private double sincePrimeMs;

	private Vector2 armPos;

	private Vector2 tapOffset;

	private bool wasHolding;

	private double cachedDt = -1.0;

	private double cachedDecay;

	private double cachedSpeedDecay;

	public double LastCoherence => coherence;

	[field: CompilerGenerated]
	public double LastGain
	{
		[CompilerGenerated]
		get;
		[CompilerGenerated]
		private set;
	} = 1.0;


	[field: CompilerGenerated]
	public bool LastBypassed
	{
		[CompilerGenerated]
		get;
		[CompilerGenerated]
		private set;
	}

	public double LastTapBlend => tapBlend;

	public double LastTapStrength => tapStrength;

	public void Reset()
	{
		primed = false;
	}

	public Vector2 Filter(Vector2 pos, double dtMs)
	{
		//IL_0001: Unknown result type (might be due to invalid IL or missing references)
		//IL_000c: Unknown result type (might be due to invalid IL or missing references)
		return Filter(pos, dtMs, 0.0);
	}

	public Vector2 Filter(Vector2 pos, double dtMs, double pressure01)
	{
		//IL_002c: Unknown result type (might be due to invalid IL or missing references)
		//IL_0039: Unknown result type (might be due to invalid IL or missing references)
		//IL_0023: Unknown result type (might be due to invalid IL or missing references)
		//IL_003b: Unknown result type (might be due to invalid IL or missing references)
		//IL_003d: Unknown result type (might be due to invalid IL or missing references)
		//IL_0042: Unknown result type (might be due to invalid IL or missing references)
		//IL_0047: Unknown result type (might be due to invalid IL or missing references)
		//IL_0049: Unknown result type (might be due to invalid IL or missing references)
		//IL_004a: Unknown result type (might be due to invalid IL or missing references)
		//IL_00b4: Unknown result type (might be due to invalid IL or missing references)
		//IL_00bb: Unknown result type (might be due to invalid IL or missing references)
		//IL_00bd: Unknown result type (might be due to invalid IL or missing references)
		//IL_00c2: Unknown result type (might be due to invalid IL or missing references)
		//IL_00c7: Unknown result type (might be due to invalid IL or missing references)
		//IL_00cc: Unknown result type (might be due to invalid IL or missing references)
		//IL_00d1: Unknown result type (might be due to invalid IL or missing references)
		//IL_014f: Unknown result type (might be due to invalid IL or missing references)
		//IL_0154: Unknown result type (might be due to invalid IL or missing references)
		//IL_01fe: Unknown result type (might be due to invalid IL or missing references)
		//IL_01ff: Unknown result type (might be due to invalid IL or missing references)
		//IL_0231: Unknown result type (might be due to invalid IL or missing references)
		//IL_0233: Unknown result type (might be due to invalid IL or missing references)
		//IL_0236: Unknown result type (might be due to invalid IL or missing references)
		//IL_023e: Unknown result type (might be due to invalid IL or missing references)
		//IL_0491: Unknown result type (might be due to invalid IL or missing references)
		//IL_0493: Unknown result type (might be due to invalid IL or missing references)
		//IL_0498: Unknown result type (might be due to invalid IL or missing references)
		//IL_049d: Unknown result type (might be due to invalid IL or missing references)
		//IL_0578: Unknown result type (might be due to invalid IL or missing references)
		//IL_057d: Unknown result type (might be due to invalid IL or missing references)
		//IL_0582: Unknown result type (might be due to invalid IL or missing references)
		//IL_0587: Unknown result type (might be due to invalid IL or missing references)
		//IL_058c: Unknown result type (might be due to invalid IL or missing references)
		//IL_0591: Unknown result type (might be due to invalid IL or missing references)
		//IL_0593: Unknown result type (might be due to invalid IL or missing references)
		//IL_0598: Unknown result type (might be due to invalid IL or missing references)
		//IL_059d: Unknown result type (might be due to invalid IL or missing references)
		//IL_05e9: Unknown result type (might be due to invalid IL or missing references)
		//IL_05c5: Unknown result type (might be due to invalid IL or missing references)
		//IL_05ca: Unknown result type (might be due to invalid IL or missing references)
		//IL_05d9: Unknown result type (might be due to invalid IL or missing references)
		//IL_05de: Unknown result type (might be due to invalid IL or missing references)
		//IL_05e3: Unknown result type (might be due to invalid IL or missing references)
		//IL_04de: Unknown result type (might be due to invalid IL or missing references)
		//IL_04e3: Unknown result type (might be due to invalid IL or missing references)
		//IL_04e8: Unknown result type (might be due to invalid IL or missing references)
		//IL_04ea: Unknown result type (might be due to invalid IL or missing references)
		//IL_04ec: Unknown result type (might be due to invalid IL or missing references)
		//IL_04ee: Unknown result type (might be due to invalid IL or missing references)
		//IL_04f5: Unknown result type (might be due to invalid IL or missing references)
		//IL_04fa: Unknown result type (might be due to invalid IL or missing references)
		//IL_04fc: Unknown result type (might be due to invalid IL or missing references)
		//IL_04fe: Unknown result type (might be due to invalid IL or missing references)
		//IL_0500: Unknown result type (might be due to invalid IL or missing references)
		//IL_0505: Unknown result type (might be due to invalid IL or missing references)
		//IL_0606: Unknown result type (might be due to invalid IL or missing references)
		//IL_0609: Unknown result type (might be due to invalid IL or missing references)
		//IL_0610: Unknown result type (might be due to invalid IL or missing references)
		//IL_0618: Unknown result type (might be due to invalid IL or missing references)
		//IL_05f6: Unknown result type (might be due to invalid IL or missing references)
		//IL_0603: Unknown result type (might be due to invalid IL or missing references)
		//IL_054c: Unknown result type (might be due to invalid IL or missing references)
		//IL_0551: Unknown result type (might be due to invalid IL or missing references)
		//IL_0556: Unknown result type (might be due to invalid IL or missing references)
		//IL_055b: Unknown result type (might be due to invalid IL or missing references)
		//IL_0560: Unknown result type (might be due to invalid IL or missing references)
		//IL_0565: Unknown result type (might be due to invalid IL or missing references)
		//IL_056a: Unknown result type (might be due to invalid IL or missing references)
		//IL_056f: Unknown result type (might be due to invalid IL or missing references)
		Sanitize();
		if (!primed || dtMs <= 0.0 || dtMs > ResetMs || !IsFinite(pos))
		{
			Prime(pos);
			prevPressure = pressure01;
			return pos;
		}
		Vector2 val = pos - lastPos;
		lastPos = pos;
		double num = (val).Length();
		double num2 = num / (dtMs * 0.001);
		if (dtMs != cachedDt)
		{
			cachedDt = dtMs;
			cachedDecay = Math.Exp((0.0 - dtMs) / TremorWindowMs);
			cachedSpeedDecay = Math.Exp((0.0 - dtMs) / 12.0);
		}
		double num3 = 1.0 - cachedDecay;
		vecEma += (float)num3 * (val - vecEma);
		magEma += num3 * (num - magEma);
		if (magEma > 1E-07)
		{
			coherence = Math.Clamp((double)(vecEma).Length() / magEma, 0.0, 1.0);
		}
		if (magEma < 1E-18)
		{
			magEma = 0.0;
			vecEma = Vector2.Zero;
		}
		if (speedEma < 1E-18)
		{
			speedEma = 0.0;
		}
		speedPreReport = speedEma;
		speedEma += (1.0 - cachedSpeedDecay) * (num2 - speedEma);
		double x = Math.Max(num2, speedEma);
		double num4 = SmoothStep(EngageSpeed, FullPassSpeed, x);
		if (num4 >= 1.0 && RailStrength <= 0.0 && SettleAssist <= 0.0)
		{
			outPos = pos;
			LastGain = 1.0;
			LastBypassed = true;
			dwellMs = 0.0;
			prevSpeed = num2;
			return TapStage(pos, LeadStage(pos, dtMs, num2), dtMs, pressure01, num2);
		}
		LastBypassed = false;
		double num5 = 0.0;
		if (AnchorStrength > 0.0)
		{
			if (coherence < CoherenceCeiling)
			{
				dwellMs += dtMs;
			}
			else
			{
				dwellMs = 0.0;
			}
			num5 = SmoothStep(0.0, AnchorTimeMs, dwellMs) * AnchorStrength;
		}
		else
		{
			dwellMs = 0.0;
		}
		double num6 = CoherenceFloor + num5 * 0.15;
		double num7 = CoherenceCeiling + num5 * 0.15;
		if (num7 > 1.0)
		{
			num7 = 1.0;
		}
		if (num6 >= num7)
		{
			num6 = num7 - 0.02;
		}
		double num8 = SmoothStep(num6, num7, coherence);
		if (SettleAssist > 0.0)
		{
			if (prevSpeed > SettleFlickSpeed && num2 < prevSpeed * 0.6)
			{
				settleBoost = 1.0;
			}
			settleBoost *= Math.Exp((0.0 - dtMs) / 120.0);
			if (settleBoost < 0.0001)
			{
				settleBoost = 0.0;
			}
			num8 *= 1.0 - settleBoost * SettleAssist;
		}
		else
		{
			settleBoost = 0.0;
		}
		prevSpeed = num2;
		double num9 = num4 + (1.0 - num4) * num8;
		if (num9 < 0.0)
		{
			num9 = 0.0;
		}
		else if (num9 > 1.0)
		{
			num9 = 1.0;
		}
		LastGain = num9;
		double num10 = 1.0 + num5 * 1.5;
		double num11 = HoldTimeMs * num10 * (1.0 - num9);
		double num12 = ((num11 <= 1E-06) ? 1.0 : (1.0 - Math.Exp((0.0 - dtMs) / num11)));
		Vector2 val2 = pos - outPos;
		if (RailStrength > 0.0 && num8 > 0.0 && (double)(vecEma).LengthSquared() > 1E-12)
		{
			Vector2 val3 = Vector2.Normalize(vecEma);
			Vector2 val4 = val3 * Vector2.Dot(val2, val3);
			Vector2 val5 = val2 - val4;
			double num13 = RailStrength * num8 * 45.0;
			double num14 = ((num13 <= 1E-06) ? num12 : Math.Min(num12, 1.0 - Math.Exp((0.0 - dtMs) / num13)));
			outPos += val4 * (float)num12 + val5 * (float)num14;
		}
		else
		{
			outPos += val2 * (float)num12;
		}
		Vector2 val6 = pos - outPos;
		double num15 = (val6).LengthSquared();
		if (num15 > MaxLag * MaxLag)
		{
			double num16 = Math.Sqrt(num15);
			outPos += val6 * (float)((num16 - MaxLag) / num16);
		}
		if (!IsFinite(outPos))
		{
			Prime(pos);
			prevPressure = pressure01;
			return pos;
		}
		return TapStage(pos, LeadStage(outPos, dtMs, num2), dtMs, pressure01, num2);
	}

	private Vector2 LeadStage(Vector2 result, double dtMs, double speed)
	{
		//IL_001d: Unknown result type (might be due to invalid IL or missing references)
		//IL_0043: Unknown result type (might be due to invalid IL or missing references)
		//IL_0066: Unknown result type (might be due to invalid IL or missing references)
		//IL_00a4: Unknown result type (might be due to invalid IL or missing references)
		//IL_00b4: Unknown result type (might be due to invalid IL or missing references)
		//IL_00b9: Unknown result type (might be due to invalid IL or missing references)
		//IL_00a1: Unknown result type (might be due to invalid IL or missing references)
		//IL_00dc: Unknown result type (might be due to invalid IL or missing references)
		//IL_00cc: Unknown result type (might be due to invalid IL or missing references)
		//IL_00d6: Unknown result type (might be due to invalid IL or missing references)
		//IL_00db: Unknown result type (might be due to invalid IL or missing references)
		//IL_00e6: Unknown result type (might be due to invalid IL or missing references)
		//IL_00e7: Unknown result type (might be due to invalid IL or missing references)
		//IL_00e8: Unknown result type (might be due to invalid IL or missing references)
		//IL_00e4: Unknown result type (might be due to invalid IL or missing references)
		if (LeadMs <= 0.0 || dtMs <= 1E-06)
		{
			return result;
		}
		double num = SmoothStep(CoherenceFloor, CoherenceCeiling, coherence);
		if (num <= 0.0)
		{
			return result;
		}
		num *= SmoothStep(LeadMinSpeed, LeadFullSpeed, speed);
		if (num <= 0.0)
		{
			return result;
		}
		if (speedEma > 1E-09)
		{
			num *= SmoothStep(LeadDecelNone, LeadDecelFull, speed / speedEma);
		}
		if (num <= 0.0)
		{
			return result;
		}
		Vector2 val = vecEma * (float)(LeadMs / dtMs * num);
		double num2 = (val).Length();
		if (num2 > LeadMaxMm)
		{
			val *= (float)(LeadMaxMm / num2);
		}
		if (!IsFinite(val))
		{
			return result;
		}
		return result + val;
	}

	private Vector2 TapStage(Vector2 pos, Vector2 clean, double dtMs, double pressure01, double speed)
	{
		//IL_00be: Unknown result type (might be due to invalid IL or missing references)
		//IL_00c3: Unknown result type (might be due to invalid IL or missing references)
		//IL_00ef: Unknown result type (might be due to invalid IL or missing references)
		//IL_00f6: Unknown result type (might be due to invalid IL or missing references)
		//IL_0239: Unknown result type (might be due to invalid IL or missing references)
		//IL_023b: Unknown result type (might be due to invalid IL or missing references)
		//IL_0240: Unknown result type (might be due to invalid IL or missing references)
		//IL_0245: Unknown result type (might be due to invalid IL or missing references)
		//IL_017a: Unknown result type (might be due to invalid IL or missing references)
		//IL_017b: Unknown result type (might be due to invalid IL or missing references)
		//IL_0180: Unknown result type (might be due to invalid IL or missing references)
		//IL_0186: Unknown result type (might be due to invalid IL or missing references)
		//IL_0187: Unknown result type (might be due to invalid IL or missing references)
		//IL_0257: Unknown result type (might be due to invalid IL or missing references)
		//IL_0259: Unknown result type (might be due to invalid IL or missing references)
		//IL_025e: Unknown result type (might be due to invalid IL or missing references)
		//IL_0263: Unknown result type (might be due to invalid IL or missing references)
		//IL_0274: Unknown result type (might be due to invalid IL or missing references)
		//IL_027a: Unknown result type (might be due to invalid IL or missing references)
		//IL_027f: Unknown result type (might be due to invalid IL or missing references)
		//IL_0284: Unknown result type (might be due to invalid IL or missing references)
		//IL_0407: Unknown result type (might be due to invalid IL or missing references)
		//IL_040c: Unknown result type (might be due to invalid IL or missing references)
		//IL_040d: Unknown result type (might be due to invalid IL or missing references)
		//IL_03ff: Unknown result type (might be due to invalid IL or missing references)
		//IL_03da: Unknown result type (might be due to invalid IL or missing references)
		//IL_03df: Unknown result type (might be due to invalid IL or missing references)
		//IL_03e0: Unknown result type (might be due to invalid IL or missing references)
		//IL_03e5: Unknown result type (might be due to invalid IL or missing references)
		//IL_0412: Unknown result type (might be due to invalid IL or missing references)
		//IL_0439: Unknown result type (might be due to invalid IL or missing references)
		//IL_0424: Unknown result type (might be due to invalid IL or missing references)
		//IL_0425: Unknown result type (might be due to invalid IL or missing references)
		//IL_042d: Unknown result type (might be due to invalid IL or missing references)
		//IL_0432: Unknown result type (might be due to invalid IL or missing references)
		//IL_043a: Unknown result type (might be due to invalid IL or missing references)
		//IL_043d: Unknown result type (might be due to invalid IL or missing references)
		//IL_0445: Unknown result type (might be due to invalid IL or missing references)
		double num = ((pressedMs <= 40.0) ? hoverSpeedEma : speedPreReport);
		if (sincePrimeMs < 40.0)
		{
			num = Math.Max(num, speedPreReport);
		}
		sincePrimeMs += dtMs;
		if (pressure01 > 0.0)
		{
			pressedMs += dtMs;
		}
		else
		{
			pressedMs = 0.0;
			hoverSpeedEma = speedEma;
		}
		if (TapAnchor <= 0.0)
		{
			tapArmed = (tapHolding = (tapBroken = (wasHolding = false)));
			tapOffset = Vector2.Zero;
			tapBlend = 0.0;
			tapMs = 0.0;
			prevPressure = pressure01;
			PushHistory(clean, dtMs);
			return clean;
		}
		double num2 = TapArmPressure * 0.5;
		if (!tapArmed && !tapBroken && pressure01 >= TapArmPressure && prevPressure < TapArmPressure)
		{
			tapArmed = true;
			tapHolding = true;
			tapMs = 0.0;
			tapSinceRelease = 0.0;
			tapFadeMs = 50.0;
			anchorPos = PickAnchor(clean);
			armPos = clean;
			tapStrength = 1.0 - Math.Clamp(TapMoveFade, 0.0, 1.0) * SmoothStep(12.0, 30.0, num);
		}
		if (pressure01 < num2)
		{
			tapBroken = false;
		}
		prevPressure = pressure01;
		if (tapArmed)
		{
			tapMs += dtMs;
			if (speed > 150.0)
			{
				tapArmed = (tapHolding = false);
				tapBroken = true;
				tapFadeMs = 0.0;
			}
			else
			{
				Vector2 val = pos - armPos;
				if (!((double)(val).Length() > TapBreakMm))
				{
					val = pos - anchorPos;
					double num3 = (val).Length();
					double tapBreakMm = TapBreakMm;
					val = anchorPos - armPos;
					if (!(num3 > Math.Max(tapBreakMm, (double)(val).Length() + 0.45)) && !(tapMs > 600.0))
					{
						if (pressure01 < num2)
						{
							tapSinceRelease += dtMs;
							if (tapSinceRelease >= TapHoldMs)
							{
								tapArmed = (tapHolding = false);
								tapFadeMs = 50.0;
							}
						}
						else
						{
							tapSinceRelease = 0.0;
						}
						goto IL_032d;
					}
				}
				tapArmed = (tapHolding = false);
				tapBroken = true;
				tapFadeMs = 8.0;
			}
		}
		goto IL_032d;
		IL_032d:
		double num4 = (tapHolding ? (TapAnchor * tapStrength) : 0.0);
		if (num4 >= tapBlend)
		{
			tapBlend = num4;
		}
		else if (tapFadeMs <= 1E-06)
		{
			tapBlend = num4;
		}
		else
		{
			tapBlend += (num4 - tapBlend) * (1.0 - Math.Exp((0.0 - dtMs) / tapFadeMs));
		}
		if (tapBlend < 0.0001)
		{
			tapBlend = 0.0;
		}
		if (wasHolding && !tapHolding)
		{
			tapOffset = anchorPos - clean;
		}
		wasHolding = tapHolding;
		Vector2 val2 = (tapHolding ? (anchorPos - clean) : tapOffset);
		Vector2 val3 = ((tapBlend <= 0.0) ? clean : (clean + val2 * (float)tapBlend));
		PushHistory(val3, dtMs);
		return val3;
	}

	private Vector2 PickAnchor(Vector2 clean)
	{
		//IL_0040: Unknown result type (might be due to invalid IL or missing references)
		//IL_0045: Unknown result type (might be due to invalid IL or missing references)
		//IL_0046: Unknown result type (might be due to invalid IL or missing references)
		//IL_004d: Unknown result type (might be due to invalid IL or missing references)
		//IL_0052: Unknown result type (might be due to invalid IL or missing references)
		//IL_0034: Unknown result type (might be due to invalid IL or missing references)
		//IL_007b: Unknown result type (might be due to invalid IL or missing references)
		//IL_007c: Unknown result type (might be due to invalid IL or missing references)
		//IL_007d: Unknown result type (might be due to invalid IL or missing references)
		//IL_0068: Unknown result type (might be due to invalid IL or missing references)
		//IL_0075: Unknown result type (might be due to invalid IL or missing references)
		//IL_007a: Unknown result type (might be due to invalid IL or missing references)
		double num = 1.0 - SmoothStep(20.0, 70.0, speedEma);
		if (num <= 0.0)
		{
			return clean;
		}
		Vector2 val = (LookBack(24.0) - clean) * (float)num;
		double num2 = (val).Length();
		if (num2 > 0.45)
		{
			val *= (float)(0.45 / num2);
		}
		return clean + val;
	}

	private void PushHistory(Vector2 p, double dtMs)
	{
		//IL_001d: Unknown result type (might be due to invalid IL or missing references)
		//IL_001e: Unknown result type (might be due to invalid IL or missing references)
		historyAt = (historyAt + 1) & 0x3F;
		history[historyAt] = p;
		historyAge[historyAt] = dtMs;
	}

	private Vector2 LookBack(double ms)
	{
		//IL_000a: Unknown result type (might be due to invalid IL or missing references)
		//IL_0060: Unknown result type (might be due to invalid IL or missing references)
		if (historyAt < 0)
		{
			return outPos;
		}
		int num = historyAt;
		double num2 = 0.0;
		for (int i = 0; i < 63; i++)
		{
			num2 += historyAge[num];
			int num3 = (num - 1) & 0x3F;
			if (num2 >= ms || historyAge[num3] <= 0.0)
			{
				break;
			}
			num = num3;
		}
		return history[num];
	}

	private void Prime(Vector2 pos)
	{
		//IL_0001: Unknown result type (might be due to invalid IL or missing references)
		//IL_0002: Unknown result type (might be due to invalid IL or missing references)
		//IL_0008: Unknown result type (might be due to invalid IL or missing references)
		//IL_0009: Unknown result type (might be due to invalid IL or missing references)
		//IL_000f: Unknown result type (might be due to invalid IL or missing references)
		//IL_0014: Unknown result type (might be due to invalid IL or missing references)
		//IL_0122: Unknown result type (might be due to invalid IL or missing references)
		//IL_0123: Unknown result type (might be due to invalid IL or missing references)
		//IL_0124: Unknown result type (might be due to invalid IL or missing references)
		//IL_0125: Unknown result type (might be due to invalid IL or missing references)
		//IL_012a: Unknown result type (might be due to invalid IL or missing references)
		//IL_012b: Unknown result type (might be due to invalid IL or missing references)
		//IL_0131: Unknown result type (might be due to invalid IL or missing references)
		//IL_0136: Unknown result type (might be due to invalid IL or missing references)
		lastPos = pos;
		outPos = pos;
		vecEma = Vector2.Zero;
		magEma = 0.0;
		speedEma = 0.0;
		speedPreReport = (hoverSpeedEma = (pressedMs = (sincePrimeMs = 0.0)));
		coherence = 1.0;
		dwellMs = 0.0;
		settleBoost = 0.0;
		prevSpeed = 0.0;
		LastGain = 1.0;
		cachedDt = -1.0;
		primed = true;
		tapArmed = (tapHolding = (tapBroken = false));
		tapBlend = 0.0;
		tapMs = (tapSinceRelease = 0.0);
		tapFadeMs = 50.0;
		prevPressure = 0.0;
		anchorPos = (armPos = pos);
		tapOffset = Vector2.Zero;
		wasHolding = false;
		historyAt = -1;
		global::System.Array.Clear((global::System.Array)historyAge, 0, historyAge.Length);
	}

	private void Sanitize()
	{
		if (!(TremorWindowMs >= 5.0))
		{
			TremorWindowMs = 5.0;
		}
		else if (TremorWindowMs > 1000.0)
		{
			TremorWindowMs = 1000.0;
		}
		if (!(HoldTimeMs >= 0.0))
		{
			HoldTimeMs = 0.0;
		}
		else if (HoldTimeMs > 2000.0)
		{
			HoldTimeMs = 2000.0;
		}
		if (!(FullPassSpeed >= 0.1))
		{
			FullPassSpeed = 0.1;
		}
		if (!(EngageSpeed >= 0.0))
		{
			EngageSpeed = 0.0;
		}
		if (EngageSpeed >= FullPassSpeed)
		{
			EngageSpeed = FullPassSpeed * 0.99;
		}
		if (!(CoherenceFloor >= 0.0))
		{
			CoherenceFloor = 0.0;
		}
		else if (CoherenceFloor > 0.98)
		{
			CoherenceFloor = 0.98;
		}
		if (CoherenceCeiling > 1.0)
		{
			CoherenceCeiling = 1.0;
		}
		if (!(CoherenceCeiling > CoherenceFloor))
		{
			CoherenceCeiling = CoherenceFloor + 0.02;
		}
		if (!(MaxLag >= 0.001))
		{
			MaxLag = 0.001;
		}
		if (!(ResetMs >= 1.0))
		{
			ResetMs = 1.0;
		}
		if (!(RailStrength >= 0.0))
		{
			RailStrength = 0.0;
		}
		else if (RailStrength > 1.0)
		{
			RailStrength = 1.0;
		}
		if (!(AnchorStrength >= 0.0))
		{
			AnchorStrength = 0.0;
		}
		else if (AnchorStrength > 1.0)
		{
			AnchorStrength = 1.0;
		}
		if (!(AnchorTimeMs >= 10.0))
		{
			AnchorTimeMs = 10.0;
		}
		else if (AnchorTimeMs > 3000.0)
		{
			AnchorTimeMs = 3000.0;
		}
		if (!(SettleAssist >= 0.0))
		{
			SettleAssist = 0.0;
		}
		else if (SettleAssist > 1.0)
		{
			SettleAssist = 1.0;
		}
		if (!(TapAnchor >= 0.0))
		{
			TapAnchor = 0.0;
		}
		else if (TapAnchor > 1.0)
		{
			TapAnchor = 1.0;
		}
		if (!(TapArmPressure >= 0.001))
		{
			TapArmPressure = 0.001;
		}
		else if (TapArmPressure > 0.9)
		{
			TapArmPressure = 0.9;
		}
		if (!(TapHoldMs >= 0.0))
		{
			TapHoldMs = 0.0;
		}
		else if (TapHoldMs > 500.0)
		{
			TapHoldMs = 500.0;
		}
		if (!(TapBreakMm >= 0.02))
		{
			TapBreakMm = 0.02;
		}
		else if (TapBreakMm > 20.0)
		{
			TapBreakMm = 20.0;
		}
		if (!(TapMoveFade >= 0.0))
		{
			TapMoveFade = 0.0;
		}
		else if (TapMoveFade > 1.0)
		{
			TapMoveFade = 1.0;
		}
		if (!(LeadMs >= 0.0))
		{
			LeadMs = 0.0;
		}
		else if (LeadMs > 8.0)
		{
			LeadMs = 8.0;
		}
		if (!(LeadMaxMm >= 0.05))
		{
			LeadMaxMm = 0.05;
		}
		else if (LeadMaxMm > 10.0)
		{
			LeadMaxMm = 10.0;
		}
	}

	private static bool IsFinite(Vector2 v)
	{
		//IL_0000: Unknown result type (might be due to invalid IL or missing references)
		//IL_000d: Unknown result type (might be due to invalid IL or missing references)
		if (float.IsFinite(v.X))
		{
			return float.IsFinite(v.Y);
		}
		return false;
	}

	private static double SmoothStep(double edge0, double edge1, double x)
	{
		if (edge1 <= edge0)
		{
			if (!(x >= edge1))
			{
				return 0.0;
			}
			return 1.0;
		}
		double num = (x - edge0) / (edge1 - edge0);
		if (num <= 0.0)
		{
			return 0.0;
		}
		if (num >= 1.0)
		{
			return 1.0;
		}
		return num * num * (3.0 - 2.0 * num);
	}
}
