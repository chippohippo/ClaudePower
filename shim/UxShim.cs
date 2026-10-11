using System;
using System.Diagnostics;
using System.IO;

/// Stands in for OpenTabletDriver.UX.Wpf.exe. The stock GUI's updater crashes on every launch
/// (0.6.7 NRE), it stomps external applies with its stale in-memory settings, and run elevated it
/// spawns a daemon nobody else can reach. Opening "the OTD GUI" now opens AimForge; the original
/// is kept alongside as OpenTabletDriver.UX.Wpf.original.exe and used as fallback if AimForge is
/// ever missing.
static class UxShim
{
    static void Main()
    {
        string aimforge = @"C:\Users\Chippo\Desktop\AimForge\AimForge.exe";
        string original = Path.Combine(AppContext.BaseDirectory, "OpenTabletDriver.UX.Wpf.original.exe");
        try
        {
            if (File.Exists(aimforge))
                Process.Start(new ProcessStartInfo(aimforge) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(aimforge)! });
            else if (File.Exists(original))
                Process.Start(new ProcessStartInfo(original) { UseShellExecute = true, WorkingDirectory = AppContext.BaseDirectory });
        }
        catch { }
    }
}
