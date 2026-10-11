using System;
using System.Runtime.InteropServices;
using System.Text;

namespace AimForge.Core
{
    /// <summary>
    /// Read-only presence check over the OS device list (SetupAPI, DIGCF_PRESENT). Opens no device and no driver - the
    /// same information Device Manager shows - so it stays inside the anti-cheat contract.
    /// </summary>
    static class Win32Devices
    {
        const int DIGCF_PRESENT = 0x2, DIGCF_ALLCLASSES = 0x4;
        static readonly IntPtr INVALID = new IntPtr(-1);

        [StructLayout(LayoutKind.Sequential)]
        struct SP_DEVINFO_DATA { public int cbSize; public Guid ClassGuid; public int DevInst; public IntPtr Reserved; }

        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr SetupDiGetClassDevsW(IntPtr classGuid, string? enumerator, IntPtr hwnd, int flags);
        [DllImport("setupapi.dll", SetLastError = true)]
        static extern bool SetupDiEnumDeviceInfo(IntPtr set, int index, ref SP_DEVINFO_DATA data);
        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool SetupDiGetDeviceInstanceIdW(IntPtr set, ref SP_DEVINFO_DATA data, StringBuilder id, int size, out int required);
        [DllImport("setupapi.dll", SetLastError = true)]
        static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);

        /// True when a PRESENT device under the enumerator (e.g. "HID") has an instance id containing `idPart`.
        public static bool AnyPresent(string enumerator, string idPart)
        {
            var set = SetupDiGetClassDevsW(IntPtr.Zero, enumerator, IntPtr.Zero, DIGCF_PRESENT | DIGCF_ALLCLASSES);
            if (set == INVALID || set == IntPtr.Zero) throw new InvalidOperationException("SetupDiGetClassDevs failed");
            try
            {
                var d = new SP_DEVINFO_DATA { cbSize = Marshal.SizeOf<SP_DEVINFO_DATA>() };
                var sb = new StringBuilder(512);
                for (int i = 0; SetupDiEnumDeviceInfo(set, i, ref d); i++)
                {
                    sb.Clear();
                    if (SetupDiGetDeviceInstanceIdW(set, ref d, sb, sb.Capacity, out _) && sb.ToString().IndexOf(idPart, StringComparison.OrdinalIgnoreCase) >= 0) return true;
                }
                return false;
            }
            finally { SetupDiDestroyDeviceInfoList(set); }
        }
    }
}
