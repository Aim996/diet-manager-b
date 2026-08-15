$script:FoundationValidationCorePath = $MyInvocation.MyCommand.Path
$script:FoundationValidationCoreDirectory = Split-Path -Parent $script:FoundationValidationCorePath
$script:FoundationUtf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:FoundationHashCache = @{}
$script:FoundationTaskId = "SH-SAFE-BASE-001"
$script:FoundationFrozenBriefSha256 = "C25EEA39A4A778AC98F9BCDE17BED136D0BE3645153EBA7E1151205F10FE4441"
$script:FoundationFrozenPolicySha256 = "C0C0E478D19C2D3473D165318EEAB689DF0C34E69D8784A8C6B3D0119319D25D"
$script:FoundationFrozenPolicyLength = 43267
$script:FoundationFrozenPolicyLineCount = 1065
$script:FoundationProductionIdentityExpectationsSha256 = "69099A76EA81F2BDACAC968C8D59BBF911FE7D06209C05CB556CEAD4CEDE8993"
$script:FoundationNodeArchiveRelativePath = "node-v24.15.0-win-x64.zip"
$script:FoundationNodeArchiveLength = 36465163
$script:FoundationNodeArchiveSha256 = "CC5149EABD53779CE1E7BDC5401643622D0C7E6800ADE18928A767E940BB0E62"

function Get-FoundationNativePathSource {
    return @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

public sealed class FoundationNativePathInfo
{
    public string VolumeSerial { get; set; }
    public string FileId { get; set; }
    public uint Attributes { get; set; }
    public long Length { get; set; }
    public DateTime LastWriteTimeUtc { get; set; }
    public string FinalPath { get; set; }
}

public sealed class FoundationNativeDirectoryEntry
{
    public string Name { get; set; }
    public uint Attributes { get; set; }
}

public sealed class FoundationNativeDirectoryBatch
{
    public FoundationNativeDirectoryEntry[] Entries { get; set; }
    public bool Completed { get; set; }
}

public static class FoundationValidationNativePath
{
    public const uint GENERIC_READ = 0x80000000;
    public const uint GENERIC_WRITE = 0x40000000;
    public const uint DELETE = 0x00010000;
    public const uint FILE_READ_ATTRIBUTES = 0x00000080;
    public const uint FILE_TRAVERSE = 0x00000020;
    public const uint FILE_SHARE_READ = 0x00000001;
    public const uint FILE_SHARE_WRITE = 0x00000002;
    public const uint OPEN_EXISTING = 3;
    public const uint CREATE_NEW = 1;
    public const uint FILE_FLAG_WRITE_THROUGH = 0x80000000;
    public const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    public const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    public const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    public const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
    public const uint IO_REPARSE_TAG_MOUNT_POINT = 0xA0000003;
    private const uint FSCTL_GET_REPARSE_POINT = 0x000900A8;
    private const uint FSCTL_SET_REPARSE_POINT = 0x000900A4;
    public const int ERROR_FILE_NOT_FOUND = 2;
    public const int ERROR_PATH_NOT_FOUND = 3;
    public const int ERROR_NO_MORE_FILES = 18;
    private const int FileDispositionInfo = 4;
    private const int FileRenameInfo = 3;
    private const int FileIdBothDirectoryInfo = 10;
    private const int FileIdBothDirectoryRestartInfo = 11;
    private const uint FILE_NAME_NORMALIZED = 0x0;
    private const uint VOLUME_NAME_DOS = 0x0;
    private const uint DUPLICATE_SAME_ACCESS = 0x00000002;
    private const uint FILE_BEGIN = 0;

    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME
    {
        public uint Low;
        public uint High;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BY_HANDLE_FILE_INFORMATION
    {
        public uint FileAttributes;
        public FILETIME CreationTime;
        public FILETIME LastAccessTime;
        public FILETIME LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FILE_DISPOSITION_INFO
    {
        [MarshalAs(UnmanagedType.Bool)] public bool DeleteFile;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        IntPtr securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateDirectoryW(string path, IntPtr securityAttributes);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(
        SafeFileHandle file,
        out BY_HANDLE_FILE_INFORMATION information);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetFileInformationByHandle(
        SafeFileHandle file,
        int fileInformationClass,
        ref FILE_DISPOSITION_INFO fileInformation,
        uint bufferSize);

    [DllImport("kernel32.dll", EntryPoint = "SetFileInformationByHandle", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetFileInformationByHandleBuffer(
        SafeFileHandle file,
        int fileInformationClass,
        IntPtr fileInformation,
        uint bufferSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandleEx(
        SafeFileHandle file,
        int fileInformationClass,
        byte[] fileInformation,
        uint bufferSize);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(
        SafeFileHandle file,
        System.Text.StringBuilder path,
        uint pathLength,
        uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WriteFile(
        SafeFileHandle file,
        byte[] buffer,
        uint bytesToWrite,
        out uint bytesWritten,
        IntPtr overlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FlushFileBuffers(SafeFileHandle file);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeviceIoControl(
        SafeFileHandle device,
        uint controlCode,
        byte[] inputBuffer,
        uint inputBufferSize,
        byte[] outputBuffer,
        uint outputBufferSize,
        out uint bytesReturned,
        IntPtr overlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetFilePointerEx(
        SafeFileHandle file,
        long distance,
        out long newPosition,
        uint moveMethod);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DuplicateHandle(
        IntPtr sourceProcess,
        SafeFileHandle sourceHandle,
        IntPtr targetProcess,
        out SafeFileHandle targetHandle,
        uint desiredAccess,
        [MarshalAs(UnmanagedType.Bool)] bool inheritHandle,
        uint options);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    private static Win32Exception Error(string operation)
    {
        return new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }

    private static string ExtendedLocalPath(string path)
    {
        if (String.IsNullOrWhiteSpace(path) || path.Length < 3 || path[1] != ':' || path[2] != '\\')
        {
            throw new InvalidOperationException("PATH_OUTSIDE_ALLOWED_ROOT");
        }
        return @"\\?\" + path;
    }

    public static SafeFileHandle TryOpenMetadata(string path, bool shareWrite, out int errorCode)
    {
        uint share = FILE_SHARE_READ | (shareWrite ? FILE_SHARE_WRITE : 0);
        SafeFileHandle handle = CreateFileW(
            ExtendedLocalPath(path),
            FILE_READ_ATTRIBUTES,
            share,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            IntPtr.Zero);
        if (handle.IsInvalid)
        {
            errorCode = Marshal.GetLastWin32Error();
            handle.Dispose();
            return null;
        }
        errorCode = 0;
        return handle;
    }

    public static SafeFileHandle OpenImmutableRead(string path)
    {
        SafeFileHandle handle = CreateFileW(
            ExtendedLocalPath(path),
            GENERIC_READ | FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            IntPtr.Zero);
        if (handle.IsInvalid)
        {
            handle.Dispose();
            throw Error("CreateFileW immutable read failed: " + path);
        }
        return handle;
    }

    public static SafeFileHandle CreateNewPinnedFile(string path)
    {
        SafeFileHandle handle = CreateFileW(
            ExtendedLocalPath(path),
            GENERIC_READ | GENERIC_WRITE | DELETE | FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ,
            IntPtr.Zero,
            CREATE_NEW,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_WRITE_THROUGH,
            IntPtr.Zero);
        if (handle.IsInvalid)
        {
            handle.Dispose();
            throw Error("CreateFileW CreateNew failed: " + path);
        }
        return handle;
    }

    public static SafeFileHandle OpenRenameParent(string path)
    {
        SafeFileHandle handle = CreateFileW(
            ExtendedLocalPath(path),
            FILE_READ_ATTRIBUTES | FILE_TRAVERSE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            IntPtr.Zero);
        if (handle.IsInvalid)
        {
            handle.Dispose();
            throw Error("CreateFileW rename parent failed: " + path);
        }
        return handle;
    }

    public static SafeFileHandle OpenWritableReparseDirectory(string path)
    {
        SafeFileHandle handle = CreateFileW(
            ExtendedLocalPath(path),
            GENERIC_READ | GENERIC_WRITE | FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_WRITE_THROUGH,
            IntPtr.Zero);
        if (handle.IsInvalid)
        {
            handle.Dispose();
            throw Error("CreateFileW writable reparse directory failed: " + path);
        }
        return handle;
    }

    public static SafeFileHandle OpenDeleteNoFollow(string path)
    {
        SafeFileHandle handle = CreateFileW(
            ExtendedLocalPath(path),
            DELETE | GENERIC_READ | FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_WRITE_THROUGH,
            IntPtr.Zero);
        if (handle.IsInvalid)
        {
            handle.Dispose();
            throw Error("CreateFileW delete no-follow failed: " + path);
        }
        return handle;
    }

    public static SafeFileHandle TryOpenDeleteNoFollow(string path, out int errorCode)
    {
        SafeFileHandle handle = CreateFileW(
            ExtendedLocalPath(path),
            DELETE | GENERIC_READ | FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_WRITE_THROUGH,
            IntPtr.Zero);
        if (handle.IsInvalid)
        {
            errorCode = Marshal.GetLastWin32Error();
            handle.Dispose();
            return null;
        }
        errorCode = 0;
        return handle;
    }

    public static SafeFileHandle TryOpenReadNoFollow(string path, out int errorCode)
    {
        SafeFileHandle handle = CreateFileW(
            ExtendedLocalPath(path),
            GENERIC_READ | FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            IntPtr.Zero);
        if (handle.IsInvalid)
        {
            errorCode = Marshal.GetLastWin32Error();
            handle.Dispose();
            return null;
        }
        errorCode = 0;
        return handle;
    }

    public static FoundationNativeDirectoryBatch EnumerateDirectoryHandleBatch(SafeFileHandle handle, bool restart)
    {
        var rows = new System.Collections.Generic.List<FoundationNativeDirectoryEntry>();
        byte[] buffer = new byte[65536];
        int informationClass = restart ? FileIdBothDirectoryRestartInfo : FileIdBothDirectoryInfo;
        if (!GetFileInformationByHandleEx(handle, informationClass, buffer, (uint)buffer.Length))
        {
            int code = Marshal.GetLastWin32Error();
            if (code == ERROR_NO_MORE_FILES)
                return new FoundationNativeDirectoryBatch { Entries = new FoundationNativeDirectoryEntry[0], Completed = true };
            throw new Win32Exception(code, "GetFileInformationByHandleEx FileIdBothDirectoryInfo failed");
        }
        int offset = 0;
        while (true)
        {
            if (offset < 0 || offset + 104 > buffer.Length) throw new InvalidOperationException("PATH_OPERATION_FAILED: malformed directory record");
            uint next = BitConverter.ToUInt32(buffer, offset);
            uint attributes = BitConverter.ToUInt32(buffer, offset + 56);
            uint nameLength = BitConverter.ToUInt32(buffer, offset + 60);
            if ((nameLength & 1) != 0 || nameLength > 32768 || offset + 104 + nameLength > buffer.Length)
                throw new InvalidOperationException("PATH_OPERATION_FAILED: malformed directory name");
            string name = System.Text.Encoding.Unicode.GetString(buffer, offset + 104, (int)nameLength);
            if (name != "." && name != "..") rows.Add(new FoundationNativeDirectoryEntry { Name = name, Attributes = attributes });
            if (next == 0) break;
            if (next < 104 || offset + next <= offset || offset + next >= buffer.Length)
                throw new InvalidOperationException("PATH_OPERATION_FAILED: malformed directory offset");
            offset += (int)next;
        }
        return new FoundationNativeDirectoryBatch { Entries = rows.ToArray(), Completed = false };
    }

    public static void MarkDelete(SafeFileHandle handle)
    {
        FILE_DISPOSITION_INFO disposition = new FILE_DISPOSITION_INFO { DeleteFile = true };
        if (!SetFileInformationByHandle(handle, FileDispositionInfo, ref disposition, (uint)Marshal.SizeOf(typeof(FILE_DISPOSITION_INFO))))
        {
            throw Error("SetFileInformationByHandle FileDispositionInfo failed");
        }
    }

    public static void RenameRelativeNoReplace(SafeFileHandle source, SafeFileHandle pinnedParent, string finalLeaf)
    {
        if (source == null || source.IsInvalid || source.IsClosed || pinnedParent == null || pinnedParent.IsInvalid || pinnedParent.IsClosed ||
            String.IsNullOrWhiteSpace(finalLeaf) || finalLeaf == "." || finalLeaf == ".." || finalLeaf.EndsWith(" ", StringComparison.Ordinal) ||
            finalLeaf.EndsWith(".", StringComparison.Ordinal) || finalLeaf.IndexOfAny(new char[] { '\\', '/', ':', '\0', '<', '>', '"', '|', '?', '*' }) >= 0)
            throw new InvalidOperationException("REPORT_ARTIFACT_PATH_INVALID");
        foreach (char character in finalLeaf)
            if (character < 32) throw new InvalidOperationException("REPORT_ARTIFACT_PATH_INVALID");
        FoundationNativePathInfo parentInfo = GetInfo(pinnedParent);
        string parentFinal = parentInfo.FinalPath;
        if ((parentInfo.Attributes & FILE_ATTRIBUTE_DIRECTORY) == 0 || (parentInfo.Attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ||
            String.IsNullOrEmpty(parentFinal) || parentFinal.Length < 7 || !parentFinal.StartsWith(@"\\?\", StringComparison.Ordinal) ||
            !Char.IsLetter(parentFinal[4]) || parentFinal[5] != ':' || parentFinal[6] != '\\')
            throw new InvalidOperationException("REPORT_TARGET_PARENT_IDENTITY_INVALID");
        string targetName = parentFinal.Substring(4).TrimEnd('\\') + "\\" + finalLeaf;
        byte[] nameBytes = System.Text.Encoding.Unicode.GetBytes(targetName);
        int rootOffset = IntPtr.Size == 8 ? 8 : 4;
        int lengthOffset = rootOffset + IntPtr.Size;
        int nameOffset = lengthOffset + 4;
        int totalLength = checked(nameOffset + 2 + nameBytes.Length);
        IntPtr buffer = Marshal.AllocHGlobal(totalLength);
        bool parentAdded = false;
        try
        {
            for (int offset = 0; offset < totalLength; offset++) Marshal.WriteByte(buffer, offset, 0);
            Marshal.WriteInt32(buffer, 0, 0);
            pinnedParent.DangerousAddRef(ref parentAdded);
            Marshal.WriteIntPtr(buffer, rootOffset, IntPtr.Zero);
            Marshal.WriteInt32(buffer, lengthOffset, nameBytes.Length);
            Marshal.Copy(nameBytes, 0, IntPtr.Add(buffer, nameOffset), nameBytes.Length);
            bool renamed = SetFileInformationByHandleBuffer(source, FileRenameInfo, buffer, (uint)totalLength);
            int errorCode = renamed ? 0 : Marshal.GetLastWin32Error();
            if (!renamed) throw new Win32Exception(errorCode, "SetFileInformationByHandle FileRenameInfo failed: " + errorCode.ToString());
        }
        finally
        {
            if (parentAdded) pinnedParent.DangerousRelease();
            Marshal.FreeHGlobal(buffer);
        }
    }

    public static string GetJunctionTarget(SafeFileHandle handle)
    {
        byte[] output = new byte[16384];
        uint returned;
        if (!DeviceIoControl(handle, FSCTL_GET_REPARSE_POINT, null, 0, output, (uint)output.Length, out returned, IntPtr.Zero))
        {
            throw Error("FSCTL_GET_REPARSE_POINT failed");
        }
        if (returned < 16 || BitConverter.ToUInt32(output, 0) != IO_REPARSE_TAG_MOUNT_POINT)
        {
            throw new InvalidOperationException("RUNTIME_IDENTITY_INVALID: unsupported reparse tag");
        }
        int substituteOffset = BitConverter.ToUInt16(output, 8);
        int substituteLength = BitConverter.ToUInt16(output, 10);
        int printOffset = BitConverter.ToUInt16(output, 12);
        int printLength = BitConverter.ToUInt16(output, 14);
        int start = 16 + substituteOffset;
        int printStart = 16 + printOffset;
        if (substituteOffset != 0 || substituteLength <= 0 || (substituteLength & 1) != 0 ||
            printOffset != substituteLength + 2 || (printLength & 1) != 0 ||
            start < 16 || start + substituteLength + 2 > returned || printStart + printLength + 2 > returned ||
            output[start + substituteLength] != 0 || output[start + substituteLength + 1] != 0 ||
            output[printStart + printLength] != 0 || output[printStart + printLength + 1] != 0)
        {
            throw new InvalidOperationException("RUNTIME_IDENTITY_INVALID: malformed junction target");
        }
        string target = System.Text.Encoding.Unicode.GetString(output, start, substituteLength);
        string printName = System.Text.Encoding.Unicode.GetString(output, printStart, printLength);
        if (!target.StartsWith(@"\??\", StringComparison.Ordinal) || target.Length < 7)
        {
            throw new InvalidOperationException("RUNTIME_IDENTITY_INVALID: unsupported junction target");
        }
        string absoluteTarget = target.Substring(4);
        if (target.IndexOf('\0') >= 0 || printName.IndexOf('\0') >= 0 ||
            (printName.Length != 0 && !printName.Equals(absoluteTarget, StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException("RUNTIME_IDENTITY_INVALID: ambiguous junction target");
        }
        return absoluteTarget;
    }

    public static void SetJunctionTarget(SafeFileHandle handle, string absoluteTarget)
    {
        if (String.IsNullOrWhiteSpace(absoluteTarget) || absoluteTarget.Length < 3 || absoluteTarget[1] != ':' || absoluteTarget[2] != '\\')
        {
            throw new InvalidOperationException("RUNTIME_IDENTITY_INVALID: invalid snapshot junction target");
        }
        string substitute = @"\??\" + absoluteTarget;
        string printName = absoluteTarget;
        byte[] substituteBytes = System.Text.Encoding.Unicode.GetBytes(substitute);
        byte[] printBytes = System.Text.Encoding.Unicode.GetBytes(printName);
        int pathBytes = substituteBytes.Length + 2 + printBytes.Length + 2;
        byte[] input = new byte[16 + pathBytes];
        Buffer.BlockCopy(BitConverter.GetBytes(IO_REPARSE_TAG_MOUNT_POINT), 0, input, 0, 4);
        Buffer.BlockCopy(BitConverter.GetBytes((ushort)(8 + pathBytes)), 0, input, 4, 2);
        Buffer.BlockCopy(BitConverter.GetBytes((ushort)0), 0, input, 8, 2);
        Buffer.BlockCopy(BitConverter.GetBytes((ushort)substituteBytes.Length), 0, input, 10, 2);
        Buffer.BlockCopy(BitConverter.GetBytes((ushort)(substituteBytes.Length + 2)), 0, input, 12, 2);
        Buffer.BlockCopy(BitConverter.GetBytes((ushort)printBytes.Length), 0, input, 14, 2);
        Buffer.BlockCopy(substituteBytes, 0, input, 16, substituteBytes.Length);
        Buffer.BlockCopy(printBytes, 0, input, 16 + substituteBytes.Length + 2, printBytes.Length);
        uint returned;
        if (!DeviceIoControl(handle, FSCTL_SET_REPARSE_POINT, input, (uint)input.Length, null, 0, out returned, IntPtr.Zero))
        {
            throw Error("FSCTL_SET_REPARSE_POINT failed");
        }
        FoundationNativePathInfo info = GetInfo(handle);
        if ((info.Attributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0)
        {
            throw new InvalidOperationException("PATH_OPERATION_FAILED: junction verification");
        }
    }

    public static void CreateDirectoryExact(string path)
    {
        if (!CreateDirectoryW(ExtendedLocalPath(path), IntPtr.Zero))
        {
            throw Error("CreateDirectoryW failed: " + path);
        }
    }

    public static FoundationNativePathInfo GetInfo(SafeFileHandle handle)
    {
        BY_HANDLE_FILE_INFORMATION information;
        if (!GetFileInformationByHandle(handle, out information))
        {
            throw Error("GetFileInformationByHandle failed");
        }
        var builder = new System.Text.StringBuilder(32768);
        uint count = GetFinalPathNameByHandleW(
            handle,
            builder,
            (uint)builder.Capacity,
            FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
        if (count == 0 || count >= builder.Capacity)
        {
            throw Error("GetFinalPathNameByHandleW failed");
        }
        long length = ((long)information.FileSizeHigh << 32) | information.FileSizeLow;
        long lastWriteFileTime = ((long)information.LastWriteTime.High << 32) | information.LastWriteTime.Low;
        return new FoundationNativePathInfo
        {
            VolumeSerial = information.VolumeSerialNumber.ToString("X8"),
            FileId = information.FileIndexHigh.ToString("X8") + information.FileIndexLow.ToString("X8"),
            Attributes = information.FileAttributes,
            Length = length,
            LastWriteTimeUtc = DateTime.FromFileTimeUtc(lastWriteFileTime),
            FinalPath = builder.ToString()
        };
    }

    public static void WriteAll(SafeFileHandle handle, byte[] bytes)
    {
        uint offset = 0;
        while (offset < bytes.Length)
        {
            uint remaining = (uint)Math.Min(1048576, bytes.Length - offset);
            byte[] chunk;
            if (offset == 0 && remaining == bytes.Length)
            {
                chunk = bytes;
            }
            else
            {
                chunk = new byte[remaining];
                Buffer.BlockCopy(bytes, (int)offset, chunk, 0, (int)remaining);
            }
            uint written;
            if (!WriteFile(handle, chunk, remaining, out written, IntPtr.Zero) || written != remaining)
            {
                throw Error("WriteFile failed");
            }
            offset += written;
        }
        if (!FlushFileBuffers(handle))
        {
            throw Error("FlushFileBuffers failed");
        }
    }

    public static byte[] ReadAll(SafeFileHandle handle)
    {
        FoundationNativePathInfo info = GetInfo(handle);
        if (info.Length < 0 || info.Length > Int32.MaxValue)
        {
            throw new InvalidOperationException("Pinned file length is unsupported");
        }
        long ignored;
        if (!SetFilePointerEx(handle, 0, out ignored, FILE_BEGIN))
        {
            throw Error("SetFilePointerEx failed");
        }
        SafeFileHandle duplicate;
        IntPtr current = GetCurrentProcess();
        if (!DuplicateHandle(current, handle, current, out duplicate, 0, false, DUPLICATE_SAME_ACCESS))
        {
            throw Error("DuplicateHandle failed");
        }
        using (duplicate)
        using (var stream = new FileStream(duplicate, FileAccess.Read, 65536, false))
        using (var memory = new MemoryStream((int)info.Length))
        {
            stream.CopyTo(memory);
            return memory.ToArray();
        }
    }

    public static SafeFileHandle DuplicatePinnedHandle(SafeFileHandle handle)
    {
        SafeFileHandle duplicate;
        IntPtr current = GetCurrentProcess();
        if (!DuplicateHandle(current, handle, current, out duplicate, 0, false, DUPLICATE_SAME_ACCESS))
        {
            throw Error("DuplicateHandle failed");
        }
        return duplicate;
    }

    public static string Sha256(SafeFileHandle handle)
    {
        long ignored;
        if (!SetFilePointerEx(handle, 0, out ignored, FILE_BEGIN))
        {
            throw Error("SetFilePointerEx failed");
        }
        SafeFileHandle duplicate;
        IntPtr current = GetCurrentProcess();
        if (!DuplicateHandle(current, handle, current, out duplicate, 0, false, DUPLICATE_SAME_ACCESS))
        {
            throw Error("DuplicateHandle failed");
        }
        using (duplicate)
        using (var stream = new FileStream(duplicate, FileAccess.Read, 65536, false))
        using (SHA256 sha = SHA256.Create())
        {
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "");
        }
    }
}
'@
}

function ConvertTo-FoundationStrictLocalPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path) -or $Path.IndexOf([char]0) -ge 0) {
        throw "PATH_OUTSIDE_ALLOWED_ROOT"
    }
    if ($Path -notmatch '^[A-Za-z]:\\' -or $Path.IndexOf('/', [System.StringComparison]::Ordinal) -ge 0 -or
        $Path.StartsWith("\\", [System.StringComparison]::Ordinal) -or
        $Path.StartsWith("\??\", [System.StringComparison]::Ordinal) -or
        $Path.StartsWith("\\?\", [System.StringComparison]::Ordinal) -or
        $Path.StartsWith("\\.\", [System.StringComparison]::Ordinal)) {
        throw "PATH_OUTSIDE_ALLOWED_ROOT"
    }
    if ($Path -match '(^|[\\/])\.\.?([\\/]|$)') {
        throw "PATH_TRAVERSAL_REJECTED"
    }
    if ($Path.Substring(2).IndexOf(":", [System.StringComparison]::Ordinal) -ge 0) {
        throw "PATH_OUTSIDE_ALLOWED_ROOT"
    }
    if ($Path.Substring(2).Contains("\\")) { throw "PATH_OUTSIDE_ALLOWED_ROOT" }
    $root = $Path.Substring(0, 3)
    if ($Path.Length -eq 3) {
        return $root
    }
    $full = $Path.TrimEnd("\")
    if ($full.Length -lt 4) { throw "PATH_OUTSIDE_ALLOWED_ROOT" }
    foreach ($segment in @($full.Substring(3) -split '\\')) {
        if ([string]::IsNullOrEmpty($segment) -or $segment -in @(".", "..") -or
            $segment.EndsWith(" ", [System.StringComparison]::Ordinal) -or
            $segment.EndsWith(".", [System.StringComparison]::Ordinal) -or
            $segment.IndexOfAny(@([char]'<', [char]'>', [char]':', [char]'"', [char]'/', [char]'\', [char]'|', [char]'?', [char]'*')) -ge 0) {
            throw "PATH_OUTSIDE_ALLOWED_ROOT"
        }
        foreach ($character in $segment.ToCharArray()) {
            if ([int]$character -lt 32) { throw "PATH_OUTSIDE_ALLOWED_ROOT" }
        }
    }
    return $full
}

function ConvertFrom-FoundationFinalHandlePath {
    param([Parameter(Mandatory = $true)][string]$Path)
    if ($Path -match '^\\\\\?\\[A-Za-z]:\\') {
        $localPath = $Path.Substring(4)
        $root = $localPath.Substring(0, 3)
        if ($localPath.Equals($root, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $root
        }
        return $localPath.TrimEnd("\", "/")
    }
    throw "PATH_IDENTITY_CHANGED"
}

function Close-FoundationPinSet {
    param($PinSet)
    if ($null -eq $PinSet) { return }
    $pins = @()
    if ($null -ne $PinSet.PSObject.Properties["pins"]) { $pins = @($PinSet.pins) }
    for ($index = $pins.Count - 1; $index -ge 0; $index--) {
        try {
            if ($null -ne $pins[$index].handle) { $pins[$index].handle.Dispose() }
        }
        catch { }
    }
}

function New-FoundationPinnedPathChain {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][bool]$ShareWrite,
        [bool]$AllowMissing = $false
    )
    Initialize-FoundationNativePathType
    $full = ConvertTo-FoundationStrictLocalPath $Path
    $volumeRoot = $full.Substring(0, 3)
    if ([string]::IsNullOrWhiteSpace($volumeRoot)) { throw "PATH_OUTSIDE_ALLOWED_ROOT" }
    $paths = New-Object System.Collections.ArrayList
    [void]$paths.Add($volumeRoot)
    $relative = $full.Substring($volumeRoot.Length).TrimStart("\")
    $cursor = $volumeRoot
    if (-not [string]::IsNullOrEmpty($relative)) {
        foreach ($segment in @($relative -split '\\')) {
            if ([string]::IsNullOrEmpty($segment) -or $segment -eq "." -or $segment -eq "..") {
                throw "PATH_TRAVERSAL_REJECTED"
            }
            $cursor = $cursor.TrimEnd("\") + "\" + $segment
            [void]$paths.Add($cursor)
        }
    }
    $pins = New-Object System.Collections.ArrayList
    $missing = New-Object System.Collections.ArrayList
    $foundMissing = $false
    try {
        foreach ($candidate in @($paths)) {
            if ($foundMissing) {
                [void]$missing.Add($candidate)
                continue
            }
            $nativeError = 0
            $handle = [FoundationValidationNativePath]::TryOpenMetadata([string]$candidate, $ShareWrite, [ref]$nativeError)
            if ($null -eq $handle) {
                if ($nativeError -in @(2, 3) -and $AllowMissing) {
                    $foundMissing = $true
                    [void]$missing.Add($candidate)
                    continue
                }
                throw "PATH_OPERATION_FAILED:CreateFileW:${candidate}:$nativeError"
            }
            try {
                $info = [FoundationValidationNativePath]::GetInfo($handle)
                if (($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0) {
                    throw "PATH_REPARSE_POINT_REJECTED:$candidate"
                }
                $finalPath = ConvertFrom-FoundationFinalHandlePath ([string]$info.FinalPath)
                $expected = ConvertTo-FoundationStrictLocalPath ([string]$candidate)
                if (-not $finalPath.Equals($expected, [System.StringComparison]::OrdinalIgnoreCase)) {
                    throw "PATH_IDENTITY_CHANGED:$candidate"
                }
                [void]$pins.Add([pscustomobject][ordered]@{
                    path = $expected
                    volume_serial = [string]$info.VolumeSerial
                    file_id = [string]$info.FileId
                    attributes = [uint32]$info.Attributes
                    share_write = $ShareWrite
                    share_delete = $false
                    handle = $handle
                })
                $handle = $null
            }
            finally {
                if ($null -ne $handle) { $handle.Dispose() }
            }
        }
        if (-not $AllowMissing -and $missing.Count -gt 0) {
            throw "PATH_OPERATION_FAILED:missing:$full"
        }
        return [pscustomobject][ordered]@{
            path = $full
            pins = @($pins)
            missing_paths = @($missing)
            share_write = $ShareWrite
            share_delete = $false
        }
    }
    catch {
        Close-FoundationPinSet ([pscustomobject]@{ pins = @($pins) })
        throw
    }
}

function New-FoundationPinnedDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [AllowNull()][scriptblock]$PathPhaseObserver = $null,
        [string]$OperationId = "root_create",
        [AllowNull()]$PathSecurityState = $null,
        [ValidateSet("runtime_snapshot_create", "root_create", "staging_copy", "evidence_publish")]
        [string]$OperationKind = "root_create"
    )
    $pinSet = New-FoundationPinnedPathChain -Path $Path -ShareWrite $true -AllowMissing $true
    $operationSucceeded = $false
    $operationError = $null
    try {
        foreach ($missingPath in @($pinSet.missing_paths)) {
            Invoke-FoundationPathPhaseObserver -Observer $PathPhaseObserver -Phase "root_after_pin_before_create" -OperationId $OperationId -PinnedPaths @($pinSet.pins) -TargetPath ([string]$missingPath)
            [FoundationValidationNativePath]::CreateDirectoryExact([string]$missingPath)
            $nativeError = 0
            $handle = [FoundationValidationNativePath]::TryOpenMetadata([string]$missingPath, $true, [ref]$nativeError)
            if ($null -eq $handle) { throw "PATH_OPERATION_FAILED:created_directory_open:${missingPath}:$nativeError" }
            try {
                $info = [FoundationValidationNativePath]::GetInfo($handle)
                if (($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0 -or
                    ($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -eq 0) {
                    throw "PATH_IDENTITY_CHANGED:$missingPath"
                }
                $finalPath = ConvertFrom-FoundationFinalHandlePath ([string]$info.FinalPath)
                $expected = ConvertTo-FoundationStrictLocalPath ([string]$missingPath)
                if (-not $finalPath.Equals($expected, [System.StringComparison]::OrdinalIgnoreCase)) {
                    throw "PATH_IDENTITY_CHANGED:$missingPath"
                }
                $pin = [pscustomobject][ordered]@{
                    path = $expected
                    volume_serial = [string]$info.VolumeSerial
                    file_id = [string]$info.FileId
                    attributes = [uint32]$info.Attributes
                    share_write = $true
                    share_delete = $false
                    handle = $handle
                }
                $handle = $null
                $pinSet.pins = @($pinSet.pins) + @($pin)
            }
            finally {
                if ($null -ne $handle) { $handle.Dispose() }
            }
        }
        $pinSet.missing_paths = @()
        $operationSucceeded = $true
        [void](Add-FoundationPathSecurityOperation -State $PathSecurityState -OperationId $OperationId -OperationKind $OperationKind -Phase "complete" -PinnedPaths @($pinSet.pins) -ImmutableInputCount 0 -Succeeded $true)
        return $pinSet
    }
    catch {
        $operationError = Get-FoundationPathOperationErrorCode $_.Exception.ToString()
        if ($null -ne $PathSecurityState -and -not $PathSecurityState.operation_ids.Contains($OperationId)) {
            [void](Add-FoundationPathSecurityOperation -State $PathSecurityState -OperationId $OperationId -OperationKind $OperationKind -Phase "complete" -PinnedPaths @($pinSet.pins) -ImmutableInputCount 0 -Succeeded $false -ErrorCode $operationError)
        }
        Close-FoundationPinSet $pinSet
        throw
    }
}

function New-FoundationPathSecurityState {
    return [pscustomobject][ordered]@{
        schema_version = "windows-handle-pin/v1"
        immutable_input_share_mode = @("FILE_SHARE_READ")
        writable_parent_share_mode = @("FILE_SHARE_READ", "FILE_SHARE_WRITE")
        share_write_for_immutable_inputs = $false
        share_delete_for_all_pins = $false
        operations = (New-Object System.Collections.ArrayList)
        operation_ids = (New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal))
    }
}

function Get-FoundationPathOperationErrorCode {
    param([AllowNull()][string]$ErrorText)
    if ([string]::IsNullOrWhiteSpace($ErrorText)) { return $null }
    if ($ErrorText -match '(PATH_IDENTITY_CHANGED|PATH_OPERATION_FAILED|PATH_REPARSE_POINT_REJECTED|PATH_OUTSIDE_ALLOWED_ROOT|PATH_ROOT_RELATION_INVALID)') {
        return [string]$Matches[1]
    }
    return "PATH_OPERATION_FAILED"
}

function Copy-FoundationPathPinRows {
    param([object[]]$Pins)
    $rowsByPath = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($pin in @($Pins)) {
        if ($null -eq $pin -or $null -eq $pin.PSObject.Properties["path"] -or
            $null -eq $pin.PSObject.Properties["volume_serial"] -or $null -eq $pin.PSObject.Properties["file_id"] -or
            $null -eq $pin.PSObject.Properties["attributes"] -or $null -eq $pin.PSObject.Properties["share_write"] -or
            $null -eq $pin.PSObject.Properties["share_delete"]) {
            throw "PATH_OPERATION_FAILED:path_pin_shape"
        }
        $path = ConvertTo-FoundationStrictLocalPath ([string]$pin.path)
        if ($rowsByPath.ContainsKey($path)) { continue }
        if ([bool]$pin.share_delete) { throw "PATH_OPERATION_FAILED:path_pin_delete_share" }
        $rowsByPath.Add($path, [pscustomobject][ordered]@{
            path = $path
            volume_serial = [string]$pin.volume_serial
            file_id = [string]$pin.file_id
            attributes = [uint32]$pin.attributes
            share_write = [bool]$pin.share_write
            share_delete = $false
        })
    }
    $orderedPaths = New-Object 'System.Collections.Generic.List[string]'
    foreach ($path in @($rowsByPath.Keys)) { [void]$orderedPaths.Add([string]$path) }
    $orderedPaths.Sort([System.StringComparer]::OrdinalIgnoreCase)
    $orderedRows = New-Object System.Collections.ArrayList
    foreach ($path in @($orderedPaths)) { [void]$orderedRows.Add($rowsByPath[[string]$path]) }
    return @($orderedRows)
}

function Add-FoundationPathSecurityOperation {
    param(
        [AllowNull()]$State,
        [Parameter(Mandatory = $true)][string]$OperationId,
        [Parameter(Mandatory = $true)]
        [ValidateSet("runtime_source_read", "runtime_snapshot_create", "runtime_snapshot_read", "manifest_read", "root_create", "staging_copy", "command_launch", "evidence_publish", "cleanup_dispose", "residual_scan")]
        [string]$OperationKind,
        [Parameter(Mandatory = $true)][ValidateSet("pin", "use", "complete")][string]$Phase,
        [object[]]$PinnedPaths = @(),
        [int]$ImmutableInputCount = -1,
        [bool]$Succeeded = $true,
        [AllowNull()][string]$ErrorCode = $null
    )
    if ($null -eq $State) { return $OperationId }
    if ([string]::IsNullOrWhiteSpace($OperationId) -or $null -eq $State.operations -or $null -eq $State.operation_ids) {
        throw "PATH_OPERATION_FAILED:path_operation_state"
    }
    if (-not $State.operation_ids.Add($OperationId)) { throw "PATH_OPERATION_FAILED:path_operation_id_reused:$OperationId" }
    $pins = @(Copy-FoundationPathPinRows $PinnedPaths)
    if ($ImmutableInputCount -lt 0) { $ImmutableInputCount = @($pins | Where-Object { -not [bool]$_.share_write }).Count }
    if ($ImmutableInputCount -lt 0) { throw "PATH_OPERATION_FAILED:path_operation_immutable_count" }
    $shareWrite = @($pins | Where-Object { [bool]$_.share_write }).Count -gt 0
    $shareDelete = @($pins | Where-Object { [bool]$_.share_delete }).Count -gt 0
    if ($shareDelete) { throw "PATH_OPERATION_FAILED:path_operation_delete_share" }
    [void]$State.operations.Add([pscustomobject][ordered]@{
        operation_id = $OperationId
        operation_kind = $OperationKind
        phase = $Phase
        pinned_paths = @($pins)
        immutable_input_count = [int]$ImmutableInputCount
        share_write = [bool]$shareWrite
        share_delete = $false
        handle_bound = [bool]($pins.Count -gt 0)
        succeeded = [bool]$Succeeded
        error_code = if ($Succeeded) { $null } elseif ([string]::IsNullOrWhiteSpace($ErrorCode)) { "PATH_OPERATION_FAILED" } else { $ErrorCode }
    })
    return $OperationId
}

function Get-FoundationPathSecurityReport {
    param([AllowNull()]$State)
    if ($null -eq $State) { $State = New-FoundationPathSecurityState }
    return [pscustomobject][ordered]@{
        schema_version = "windows-handle-pin/v1"
        immutable_input_share_mode = @("FILE_SHARE_READ")
        writable_parent_share_mode = @("FILE_SHARE_READ", "FILE_SHARE_WRITE")
        share_write_for_immutable_inputs = $false
        share_delete_for_all_pins = $false
        operations = @($State.operations | ForEach-Object {
            [pscustomobject][ordered]@{
                operation_id = [string]$_.operation_id; operation_kind = [string]$_.operation_kind; phase = [string]$_.phase
                pinned_paths = @(Copy-FoundationPathPinRows $_.pinned_paths); immutable_input_count = [int]$_.immutable_input_count
                share_write = [bool]$_.share_write; share_delete = $false; handle_bound = [bool]$_.handle_bound
                succeeded = [bool]$_.succeeded; error_code = $_.error_code
            }
        })
    }
}

function Invoke-FoundationPathPhaseObserver {
    param(
        [AllowNull()][scriptblock]$Observer,
        [Parameter(Mandatory = $true)]
        [ValidateSet("root_after_pin_before_create", "staging_after_source_pin_before_copy", "runtime_snapshot_after_input_pin_before_launch", "evidence_after_temp_write_before_rename", "cleanup_after_entry_pin_before_dispose")]
        [string]$Phase,
        [Parameter(Mandatory = $true)][string]$OperationId,
        [object[]]$PinnedPaths = @(),
        [Parameter(Mandatory = $true)][string]$TargetPath
    )
    if ($null -eq $Observer) { return }
    $request = [pscustomobject][ordered]@{
        phase = $Phase
        operation_id = $OperationId
        pinned_paths = @(Copy-FoundationPathPinRows $PinnedPaths)
        target_path = ConvertTo-FoundationStrictLocalPath $TargetPath
    }
    try { & $Observer $request }
    catch { throw "PATH_OPERATION_FAILED:${Phase}:$($_.Exception.ToString())" }
}

function Add-FoundationPathSnapshotOperation {
    param(
        [AllowNull()]$State,
        [Parameter(Mandatory = $true)][string]$OperationId,
        [Parameter(Mandatory = $true)]
        [ValidateSet("manifest_read", "evidence_publish", "cleanup_dispose", "residual_scan", "command_launch")]
        [string]$OperationKind,
        [string[]]$Paths,
        [bool]$ShareWrite,
        [bool]$AllowMissing,
        [ValidateSet("pin", "use", "complete")][string]$Phase = "complete",
        [bool]$Succeeded = $true,
        [AllowNull()][string]$ErrorCode = $null
    )
    if ($null -eq $State) { return $OperationId }
    $pinSets = New-Object System.Collections.ArrayList
    $pins = New-Object System.Collections.ArrayList
    try {
        foreach ($path in @($Paths)) {
            if ([string]::IsNullOrWhiteSpace([string]$path)) { continue }
            $pinSet = New-FoundationPinnedPathChain -Path ([string]$path) -ShareWrite $ShareWrite -AllowMissing $AllowMissing
            [void]$pinSets.Add($pinSet)
            foreach ($pin in @($pinSet.pins)) { [void]$pins.Add($pin) }
        }
        [void](Add-FoundationPathSecurityOperation -State $State -OperationId $OperationId -OperationKind $OperationKind -Phase $Phase -PinnedPaths @($pins) -Succeeded $Succeeded -ErrorCode $ErrorCode)
        return $OperationId
    }
    finally {
        foreach ($pinSet in @($pinSets)) { Close-FoundationPinSet $pinSet }
    }
}

function Get-FoundationSha256Bytes {
    param([byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace("-", "")
    }
    finally {
        $sha.Dispose()
    }
}

function Get-FoundationSha256Text {
    param([AllowEmptyString()][string]$Text)
    return Get-FoundationSha256Bytes $script:FoundationUtf8NoBom.GetBytes([string]$Text)
}

function Get-FoundationObjectValue {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Name
    )
    if ($Object -is [System.Collections.IDictionary]) {
        foreach ($key in @($Object.Keys)) {
            if ([string]::Equals([string]$key, $Name, [System.StringComparison]::OrdinalIgnoreCase)) {
                return $Object[$key]
            }
        }
        return $null
    }
    $matches = @($Object.PSObject.Properties | Where-Object {
        [string]::Equals([string]$_.Name, $Name, [System.StringComparison]::OrdinalIgnoreCase)
    })
    if ($matches.Count -ne 1) { return $null }
    return $matches[0].Value
}

function Get-FoundationObjectNames {
    param([Parameter(Mandatory = $true)]$Object)
    if ($Object -is [System.Collections.IDictionary]) {
        return @($Object.Keys | ForEach-Object { [string]$_ })
    }
    return @($Object.PSObject.Properties | ForEach-Object { [string]$_.Name })
}

function Assert-FoundationExactPropertySet {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string[]]$Expected,
        [Parameter(Mandatory = $true)][string]$ErrorCode
    )
    if ($null -eq $Object) { throw $ErrorCode }
    $actual = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($name in @(Get-FoundationObjectNames $Object)) {
        if ([string]::IsNullOrWhiteSpace($name) -or -not $actual.Add($name)) { throw $ErrorCode }
    }
    if ($actual.Count -ne $Expected.Count) { throw $ErrorCode }
    foreach ($name in $Expected) {
        if (-not $actual.Contains($name)) { throw $ErrorCode }
    }
}

function Assert-FoundationNoRuntimeModeFields {
    param($Runtime)
    $forbidden = @("mode", "is_test", "skip_identity", "use_production_guards", "snapshot_path", "fixture_owned")
    foreach ($name in @(Get-FoundationObjectNames $Runtime)) {
        if ($forbidden -contains $name.ToLowerInvariant()) { throw "RUNTIME_SHAPE_INVALID" }
    }
    $identity = Get-FoundationObjectValue $Runtime "identity_expectations"
    if ($null -ne $identity) {
        foreach ($name in @(Get-FoundationObjectNames $identity)) {
            if ($forbidden -contains $name.ToLowerInvariant()) { throw "RUNTIME_SHAPE_INVALID" }
        }
    }
}

function Get-FoundationSelfProjectRoot {
    $sharedRoot = Split-Path -Parent $script:FoundationValidationCoreDirectory
    return Get-FoundationFullPath (Split-Path -Parent $sharedRoot)
}

function Get-FoundationProductionLayoutConstants {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)
    $project = ConvertTo-FoundationStrictLocalPath $ProjectRoot
    $toolModules = Join-Path $project "version-c-strict-plugin\node_modules"
    $pnpm = Join-Path $toolModules ".pnpm"
    return [pscustomobject][ordered]@{
        temporary_parent = "C:\Users\10481\AppData\Local\Temp\diet-manager-shared"
        node_path = "C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0\node-v24.15.0-win-x64\node.exe"
        tool_modules_path = $toolModules
        vitest_path = Join-Path $toolModules "vitest\vitest.mjs"
        typescript_path = Join-Path $toolModules "typescript\bin\tsc"
        openclaw_path = Join-Path $toolModules "openclaw\openclaw.mjs"
        dependency_source_roots = [pscustomobject][ordered]@{
            node_root = "C:\Users\10481\AppData\Local\Temp\diet-manager-validation-node-24.15.0"
            tool_modules_root = $toolModules
            pnpm_root = $pnpm
            typebox_root = Join-Path $pnpm "typebox@1.3.11\node_modules\typebox"
        }
        protected_external_paths = [pscustomobject][ordered]@{
            jiti_openclaw_cache_guard = "C:\Users\10481\AppData\Local\Temp\jiti\openclaw"
            node_compile_cache_guard = "C:\Users\10481\AppData\Local\Temp\node-compile-cache\openclaw"
            inherited_openclaw_temp_guard = "C:\Users\10481\AppData\Local\Temp\openclaw"
            vitest_b_cache_guard = Join-Path $project "version-b-lite-plugin\node_modules\.vite\vitest"
            vitest_c_cache_guard = Join-Path $project "version-c-strict-plugin\node_modules\.vite\vitest"
        }
    }
}

function Test-FoundationPathEqual {
    param([string]$Left, [string]$Right)
    $leftFull = ConvertTo-FoundationStrictLocalPath $Left
    $rightFull = ConvertTo-FoundationStrictLocalPath $Right
    return $leftFull.Equals($rightFull, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-FoundationRuntimeContract {
    param(
        [Parameter(Mandatory = $true)]$Runtime,
        [Parameter(Mandatory = $true)][string]$ProjectRoot
    )
    $topNames = @(
        "temporary_parent", "node_path", "tool_modules_path", "vitest_path",
        "typescript_path", "openclaw_path", "dependency_source_roots",
        "protected_external_paths", "identity_expectations"
    )
    Assert-FoundationExactPropertySet $Runtime $topNames "RUNTIME_SHAPE_INVALID"
    Assert-FoundationNoRuntimeModeFields $Runtime
    $dependency = Get-FoundationObjectValue $Runtime "dependency_source_roots"
    $guards = Get-FoundationObjectValue $Runtime "protected_external_paths"
    Assert-FoundationExactPropertySet $dependency @("node_root", "tool_modules_root", "pnpm_root", "typebox_root") "RUNTIME_SHAPE_INVALID"
    Assert-FoundationExactPropertySet $guards @("jiti_openclaw_cache_guard", "node_compile_cache_guard", "inherited_openclaw_temp_guard", "vitest_b_cache_guard", "vitest_c_cache_guard") "RUNTIME_SHAPE_INVALID"
    $identity = Get-FoundationObjectValue $Runtime "identity_expectations"
    if ($null -eq $identity) { throw "RUNTIME_SHAPE_INVALID" }
    $identityJson = [string]($identity | ConvertTo-Json -Depth 32 -Compress)
    try { $identityClone = $identityJson | ConvertFrom-Json -ErrorAction Stop }
    catch { throw "RUNTIME_SHAPE_INVALID" }

    $normalizedDependency = [ordered]@{}
    foreach ($name in @("node_root", "tool_modules_root", "pnpm_root", "typebox_root")) {
        $normalizedDependency[$name] = ConvertTo-FoundationStrictLocalPath ([string](Get-FoundationObjectValue $dependency $name))
    }
    $normalizedGuards = [ordered]@{}
    foreach ($name in @("jiti_openclaw_cache_guard", "node_compile_cache_guard", "inherited_openclaw_temp_guard", "vitest_b_cache_guard", "vitest_c_cache_guard")) {
        $normalizedGuards[$name] = ConvertTo-FoundationStrictLocalPath ([string](Get-FoundationObjectValue $guards $name))
    }
    $normalized = [pscustomobject][ordered]@{
        temporary_parent = ConvertTo-FoundationStrictLocalPath ([string](Get-FoundationObjectValue $Runtime "temporary_parent"))
        node_path = ConvertTo-FoundationStrictLocalPath ([string](Get-FoundationObjectValue $Runtime "node_path"))
        tool_modules_path = ConvertTo-FoundationStrictLocalPath ([string](Get-FoundationObjectValue $Runtime "tool_modules_path"))
        vitest_path = ConvertTo-FoundationStrictLocalPath ([string](Get-FoundationObjectValue $Runtime "vitest_path"))
        typescript_path = ConvertTo-FoundationStrictLocalPath ([string](Get-FoundationObjectValue $Runtime "typescript_path"))
        openclaw_path = ConvertTo-FoundationStrictLocalPath ([string](Get-FoundationObjectValue $Runtime "openclaw_path"))
        dependency_source_roots = [pscustomobject]$normalizedDependency
        protected_external_paths = [pscustomobject]$normalizedGuards
        identity_expectations = $identityClone
    }

    $selfProject = Get-FoundationSelfProjectRoot
    if (Test-FoundationPathEqual $ProjectRoot $selfProject) {
        $expected = Get-FoundationProductionLayoutConstants $selfProject
        foreach ($name in @("temporary_parent", "node_path", "tool_modules_path", "vitest_path", "typescript_path", "openclaw_path")) {
            if (-not (Test-FoundationPathEqual ([string]$normalized.$name) ([string]$expected.$name))) {
                throw "RUNTIME_PRODUCTION_LAYOUT_INVALID:$name"
            }
        }
        foreach ($name in @("node_root", "tool_modules_root", "pnpm_root", "typebox_root")) {
            if (-not (Test-FoundationPathEqual ([string]$normalized.dependency_source_roots.$name) ([string]$expected.dependency_source_roots.$name))) {
                throw "RUNTIME_PRODUCTION_LAYOUT_INVALID:dependency_source_roots.$name"
            }
        }
        foreach ($name in @("jiti_openclaw_cache_guard", "node_compile_cache_guard", "inherited_openclaw_temp_guard", "vitest_b_cache_guard", "vitest_c_cache_guard")) {
            if (-not (Test-FoundationPathEqual ([string]$normalized.protected_external_paths.$name) ([string]$expected.protected_external_paths.$name))) {
                throw "RUNTIME_PRODUCTION_LAYOUT_INVALID:protected_external_paths.$name"
            }
        }
        if ((Get-FoundationSha256Text $identityJson) -cne $script:FoundationProductionIdentityExpectationsSha256) {
            throw "RUNTIME_PRODUCTION_IDENTITY_INVALID"
        }
    }
    return $normalized
}

function Test-FoundationRunId {
    param([AllowNull()]$RunId)
    if (-not ($RunId -is [string])) { return $false }
    return ([string]$RunId).Length -ge 1 -and ([string]$RunId).Length -le 128 -and
        ([string]$RunId) -cmatch '\A[A-Za-z0-9-]{1,128}\z'
}

function New-FoundationRootLayout {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string]$EvidenceRoot,
        [Parameter(Mandatory = $true)]$Runtime,
        [Parameter(Mandatory = $true)][string]$RunId
    )
    if (-not (Test-FoundationRunId $RunId)) { throw "RUN_ID_INVALID" }
    $project = ConvertTo-FoundationStrictLocalPath $ProjectRoot
    $evidence = ConvertTo-FoundationStrictLocalPath $EvidenceRoot
    $expectedEvidence = Join-Path $project "docs\evidence"
    if (-not (Test-FoundationPathEqual $evidence $expectedEvidence)) { throw "PATH_ROOT_RELATION_INVALID" }
    $temporaryParent = [string]$Runtime.temporary_parent
    $definitions = New-Object System.Collections.ArrayList
    foreach ($item in @(
        [pscustomobject]@{ root_id = "isolated_test_root"; type_segment = "isolated-test" },
        [pscustomobject]@{ root_id = "validation_root"; type_segment = "validation" },
        [pscustomobject]@{ root_id = "build_root"; type_segment = "build" },
        [pscustomobject]@{ root_id = "openclaw_state_root"; type_segment = "openclaw" }
    )) {
        $trustedParent = Join-Path $temporaryParent ([string]$item.type_segment)
        $path = Join-Path (Join-Path $trustedParent $script:FoundationTaskId) $RunId
        [void]$definitions.Add([pscustomobject][ordered]@{
            root_id = [string]$item.root_id
            type_segment = [string]$item.type_segment
            trusted_parent = ConvertTo-FoundationStrictLocalPath $trustedParent
            path = ConvertTo-FoundationStrictLocalPath $path
        })
    }
    $map = @{}
    foreach ($definition in @($definitions)) { $map[$definition.root_id] = [string]$definition.path }
    $snapshotRoot = Join-Path $map.validation_root "runtime-snapshot"
    return [pscustomobject][ordered]@{
        project_root = $project
        evidence_root = $evidence
        temporary_parent = $temporaryParent
        task_id = $script:FoundationTaskId
        run_id = $RunId
        route_roots = [pscustomobject][ordered]@{
            A = Join-Path $project "version-a-skill-only"
            B = Join-Path $project "version-b-lite-plugin"
            C = Join-Path $project "version-c-strict-plugin"
        }
        writable_root_definitions = @($definitions)
        isolated_test_root = $map.isolated_test_root
        validation_root = $map.validation_root
        build_root = $map.build_root
        openclaw_state_root = $map.openclaw_state_root
        runtime_snapshot_root = $snapshotRoot
        runtime_snapshot_node_root = Join-Path $snapshotRoot "node"
        runtime_snapshot_pnpm_root = Join-Path $snapshotRoot "pnpm"
        runtime_policy_path = Join-Path $snapshotRoot "policy\foundation-node-policy.mjs"
    }
}

function Test-FoundationPathsDisjoint {
    param([string]$Left, [string]$Right)
    $leftFull = ConvertTo-FoundationStrictLocalPath $Left
    $rightFull = ConvertTo-FoundationStrictLocalPath $Right
    if ($leftFull.Equals($rightFull, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
    if (Test-FoundationPathContained -Parent $leftFull -Candidate $rightFull) { return $false }
    if (Test-FoundationPathContained -Parent $rightFull -Candidate $leftFull) { return $false }
    return $true
}

function Assert-FoundationProtectedGuardLayout {
    param(
        [Parameter(Mandatory = $true)]$Layout,
        [Parameter(Mandatory = $true)]$Runtime
    )
    $guards = $Runtime.protected_external_paths
    if (Test-FoundationPathEqual $Layout.project_root (Get-FoundationSelfProjectRoot)) {
        return $null
    }
    $systemGuardNames = [ordered]@{
        jiti_openclaw_cache_guard = "jiti-openclaw"
        node_compile_cache_guard = "node-compile-openclaw"
        inherited_openclaw_temp_guard = "openclaw"
    }
    $guardParent = $null
    foreach ($name in $systemGuardNames.Keys) {
        $path = ConvertTo-FoundationStrictLocalPath ([string](Get-FoundationObjectValue $guards $name))
        if (-not [System.IO.Path]::GetFileName($path).Equals([string]$systemGuardNames[$name], [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "PATH_ROOT_RELATION_INVALID"
        }
        $parent = ConvertTo-FoundationStrictLocalPath (Split-Path -Parent $path)
        if ($null -eq $guardParent) { $guardParent = $parent }
        elseif (-not $guardParent.Equals($parent, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "PATH_ROOT_RELATION_INVALID"
        }
    }
    foreach ($name in $systemGuardNames.Keys) {
        $expected = Join-Path $guardParent ([string]$systemGuardNames[$name])
        if (-not (Test-FoundationPathEqual ([string](Get-FoundationObjectValue $guards $name)) $expected)) {
            throw "PATH_ROOT_RELATION_INVALID"
        }
    }
    $temporaryParentOwner = ConvertTo-FoundationStrictLocalPath (Split-Path -Parent ([string]$Layout.temporary_parent))
    $guardParentOwner = ConvertTo-FoundationStrictLocalPath (Split-Path -Parent $guardParent)
    if (-not $temporaryParentOwner.Equals($guardParentOwner, [System.StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-FoundationPathsDisjoint $Layout.temporary_parent $guardParent)) {
        throw "PATH_ROOT_RELATION_INVALID"
    }
    $expectedVitestB = Join-Path $Layout.route_roots.B "node_modules\.vite\vitest"
    $expectedVitestC = Join-Path $Layout.route_roots.C "node_modules\.vite\vitest"
    if (-not (Test-FoundationPathEqual ([string]$guards.vitest_b_cache_guard) $expectedVitestB) -or
        -not (Test-FoundationPathEqual ([string]$guards.vitest_c_cache_guard) $expectedVitestC)) {
        throw "PATH_ROOT_RELATION_INVALID"
    }
    return $guardParent
}

function Assert-FoundationRootMatrix {
    param(
        [Parameter(Mandatory = $true)]$Layout,
        [Parameter(Mandatory = $true)]$Runtime
    )
    $official = @(
        Join-Path $Layout.route_roots.A "data"
        Join-Path $Layout.route_roots.B "data"
        Join-Path $Layout.route_roots.C "data"
    )
    for ($left = 0; $left -lt $official.Count; $left++) {
        for ($right = $left + 1; $right -lt $official.Count; $right++) {
            if (-not (Test-FoundationPathsDisjoint $official[$left] $official[$right])) { throw "PATH_ROOT_RELATION_INVALID" }
        }
    }
    $writable = @($Layout.writable_root_definitions | ForEach-Object { [string]$_.path })
    for ($left = 0; $left -lt $writable.Count; $left++) {
        for ($right = $left + 1; $right -lt $writable.Count; $right++) {
            if (-not (Test-FoundationPathsDisjoint $writable[$left] $writable[$right])) { throw "PATH_ROOT_RELATION_INVALID" }
        }
    }
    $readonly = New-Object System.Collections.ArrayList
    foreach ($path in @($Layout.project_root; $Layout.evidence_root) + $official) { [void]$readonly.Add([string]$path) }
    foreach ($name in @("node_root", "tool_modules_root", "pnpm_root", "typebox_root")) {
        [void]$readonly.Add([string]$Runtime.dependency_source_roots.$name)
    }
    foreach ($name in @("jiti_openclaw_cache_guard", "node_compile_cache_guard", "inherited_openclaw_temp_guard", "vitest_b_cache_guard", "vitest_c_cache_guard")) {
        [void]$readonly.Add([string]$Runtime.protected_external_paths.$name)
    }
    $guardParent = Assert-FoundationProtectedGuardLayout -Layout $Layout -Runtime $Runtime
    if ($null -ne $guardParent) { [void]$readonly.Add([string]$guardParent) }
    foreach ($readPath in @($readonly)) {
        if (-not (Test-FoundationPathsDisjoint $Layout.temporary_parent $readPath)) { throw "PATH_ROOT_RELATION_INVALID" }
    }
    foreach ($writePath in $writable) {
        foreach ($readPath in @($readonly)) {
            if (-not (Test-FoundationPathsDisjoint $writePath $readPath)) { throw "PATH_ROOT_RELATION_INVALID" }
        }
    }
    if (-not (Test-FoundationPathContained -Parent $Layout.validation_root -Candidate $Layout.runtime_snapshot_root)) {
        throw "PATH_ROOT_RELATION_INVALID"
    }
    foreach ($writePath in @($Layout.isolated_test_root, $Layout.build_root, $Layout.openclaw_state_root)) {
        if (-not (Test-FoundationPathsDisjoint $Layout.runtime_snapshot_root $writePath)) { throw "PATH_ROOT_RELATION_INVALID" }
    }
    return [pscustomobject][ordered]@{
        validated = $true
        official_roots = @($official)
        writable_roots = @($writable)
        runtime_snapshot_relation = "validation_root_registered_descendant"
    }
}

function Get-FoundationFrozenPolicyContract {
    $project = Get-FoundationSelfProjectRoot
    $briefPath = Join-Path $project "docs\work-items\SH-SAFE-BASE-001-brief.md"
    $briefPin = New-FoundationPinnedPathChain -Path $briefPath -ShareWrite $false -AllowMissing $false
    $leafHandle = $null
    try {
        $leafHandle = [FoundationValidationNativePath]::OpenImmutableRead($briefPath)
        $briefBytes = [FoundationValidationNativePath]::ReadAll($leafHandle)
        $briefHash = Get-FoundationSha256Bytes $briefBytes
        if ($briefHash -cne $script:FoundationFrozenBriefSha256) { throw "TRUSTED_POLICY_CONTRACT_INVALID" }
        $strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
        $briefText = $strictUtf8.GetString($briefBytes)
        $ticks = ([char]96).ToString() + ([char]96).ToString() + ([char]96).ToString()
        $firstLine = "import { createRequire, syncBuiltinESMExports } from 'node:module';"
        $openFence = $ticks + "javascript" + [char]10
        $openMarker = $openFence + $firstLine
        $openIndex = $briefText.IndexOf($openMarker, [System.StringComparison]::Ordinal)
        if ($openIndex -lt 0 -or $briefText.IndexOf($openMarker, $openIndex + 1, [System.StringComparison]::Ordinal) -ge 0) {
            throw "TRUSTED_POLICY_CONTRACT_INVALID"
        }
        $contentStart = $openIndex + $openFence.Length
        $closeMarker = ([char]10).ToString() + $ticks
        $closeIndex = $briefText.IndexOf($closeMarker, $contentStart, [System.StringComparison]::Ordinal)
        if ($closeIndex -le $contentStart) { throw "TRUSTED_POLICY_CONTRACT_INVALID" }
        $text = $briefText.Substring($contentStart, $closeIndex - $contentStart)
        $bytes = $strictUtf8.GetBytes($text)
        if ($bytes.Length -ne $script:FoundationFrozenPolicyLength -or
            $text.Split([char]10).Count -ne $script:FoundationFrozenPolicyLineCount -or
            (Get-FoundationSha256Bytes $bytes) -cne $script:FoundationFrozenPolicySha256 -or
            $text.IndexOf([char]13) -ge 0 -or $text.EndsWith(([char]10).ToString(), [System.StringComparison]::Ordinal)) {
            throw "TRUSTED_POLICY_CONTRACT_INVALID"
        }
        foreach ($byte in $bytes) { if ($byte -gt 127) { throw "TRUSTED_POLICY_CONTRACT_INVALID" } }
        return [pscustomobject][ordered]@{
            schema_version = "foundation-trusted-policy/v2"
            text = $text
            bytes = $bytes
            line_count = $script:FoundationFrozenPolicyLineCount
            length = $script:FoundationFrozenPolicyLength
            sha256 = $script:FoundationFrozenPolicySha256
            ascii_only = $true
            source_contract_path = $briefPath
            source_contract_sha256 = $script:FoundationFrozenBriefSha256
        }
    }
    finally {
        if ($null -ne $leafHandle) { $leafHandle.Dispose() }
        Close-FoundationPinSet $briefPin
    }
}

function New-FoundationPolicyModule {
    param(
        [Parameter(Mandatory = $true)]$Layout,
        [AllowNull()][scriptblock]$PathPhaseObserver = $null,
        [AllowNull()]$PathSecurityState = $null
    )
    Initialize-FoundationNativePathType
    $contract = Get-FoundationFrozenPolicyContract
    $policyDirectory = Split-Path -Parent ([string]$Layout.runtime_policy_path)
    $directoryPins = New-FoundationPinnedDirectory -Path $policyDirectory -PathPhaseObserver $PathPhaseObserver -OperationId "runtime_policy_directory" -PathSecurityState $PathSecurityState -OperationKind "runtime_snapshot_create"
    $writeHandle = $null
    $readHandle = $null
    try {
        $expectedPath = ConvertTo-FoundationStrictLocalPath ([string]$Layout.runtime_policy_path)
        $writeHandle = [FoundationValidationNativePath]::CreateNewPinnedFile($expectedPath)
        [FoundationValidationNativePath]::WriteAll($writeHandle, [byte[]]$contract.bytes)
        $writeInfo = [FoundationValidationNativePath]::GetInfo($writeHandle)
        $writeHash = [FoundationValidationNativePath]::Sha256($writeHandle)
        $writeFinalPath = ConvertFrom-FoundationFinalHandlePath ([string]$writeInfo.FinalPath)
        if (($writeInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0 -or
            ($writeInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0 -or
            [long]$writeInfo.Length -ne [long]$contract.length -or $writeHash -cne [string]$contract.sha256 -or
            -not $writeFinalPath.Equals($expectedPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "TRUSTED_POLICY_BOOTSTRAP_INVALID"
        }
        $createdVolumeSerial = [string]$writeInfo.VolumeSerial
        $createdFileId = [string]$writeInfo.FileId
        $writeHandle.Dispose()
        $writeHandle = $null

        $readHandle = [FoundationValidationNativePath]::OpenImmutableRead($expectedPath)
        $readInfo = [FoundationValidationNativePath]::GetInfo($readHandle)
        $readHash = [FoundationValidationNativePath]::Sha256($readHandle)
        $readFinalPath = ConvertFrom-FoundationFinalHandlePath ([string]$readInfo.FinalPath)
        if (($readInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0 -or
            ($readInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0 -or
            -not $readFinalPath.Equals($expectedPath, [System.StringComparison]::OrdinalIgnoreCase) -or
            [string]$readInfo.VolumeSerial -cne $createdVolumeSerial -or [string]$readInfo.FileId -cne $createdFileId -or
            [long]$readInfo.Length -ne [long]$contract.length -or $readHash -cne [string]$contract.sha256) {
            throw "TRUSTED_POLICY_BOOTSTRAP_INVALID"
        }
        $result = [pscustomobject][ordered]@{
            schema_version = [string]$contract.schema_version
            path = $expectedPath
            module_url = ([System.Uri]$expectedPath).AbsoluteUri
            line_count = [int]$contract.line_count
            length = [int]$contract.length
            sha256 = [string]$contract.sha256
            ascii_only = $true
            volume_serial = [string]$readInfo.VolumeSerial
            file_id = [string]$readInfo.FileId
            pin_handle = $readHandle
            directory_pins = $directoryPins
        }
        $readHandle = $null
        $directoryPins = $null
        return $result
    }
    finally {
        if ($null -ne $readHandle) { $readHandle.Dispose() }
        if ($null -ne $writeHandle) { $writeHandle.Dispose() }
        if ($null -ne $directoryPins) { Close-FoundationPinSet $directoryPins }
    }
}

function Close-FoundationPolicyModule {
    param($PolicyModule)
    if ($null -eq $PolicyModule) { return }
    try { if ($null -ne $PolicyModule.pin_handle) { $PolicyModule.pin_handle.Dispose() } } catch { }
    try { if ($null -ne $PolicyModule.directory_pins) { Close-FoundationPinSet $PolicyModule.directory_pins } } catch { }
}

function Get-FoundationCachedFileHash {
    param([string]$Path)
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    $key = $item.FullName + "|" + $item.Length + "|" + $item.LastWriteTimeUtc.Ticks
    if (-not $script:FoundationHashCache.ContainsKey($key)) {
        $script:FoundationHashCache[$key] = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
    }
    return [string]$script:FoundationHashCache[$key]
}

function Get-FoundationFullPath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "PATH_EMPTY"
    }
    return ConvertTo-FoundationStrictLocalPath $Path
}

function Test-FoundationPathContained {
    param([string]$Parent, [string]$Candidate, [switch]$AllowEqual)
    $parentFull = Get-FoundationFullPath $Parent
    $candidateFull = Get-FoundationFullPath $Candidate
    if ($AllowEqual -and $candidateFull.Equals($parentFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }
    $prefix = $parentFull + [System.IO.Path]::DirectorySeparatorChar
    return $candidateFull.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-FoundationExistingPathChain {
    param([string]$TrustedParent, [string]$Candidate)
    $parentFull = Get-FoundationFullPath $TrustedParent
    $candidateFull = Get-FoundationFullPath $Candidate
    if (-not (Test-FoundationPathContained -Parent $parentFull -Candidate $candidateFull -AllowEqual)) {
        return $false
    }
    $probe = $candidateFull
    while ($true) {
        if (Test-Path -LiteralPath $probe) {
            $item = Get-Item -LiteralPath $probe -Force -ErrorAction Stop
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                return $false
            }
        }
        $root = [System.IO.Path]::GetPathRoot($probe).TrimEnd("\", "/")
        if ($probe.TrimEnd("\", "/").Equals($root, [System.StringComparison]::OrdinalIgnoreCase)) {
            break
        }
        $next = Split-Path -Parent $probe
        if ([string]::IsNullOrWhiteSpace($next) -or $next -eq $probe) {
            return $false
        }
        $probe = $next
    }
    return $true
}

function New-FoundationSafeDirectory {
    param(
        [string]$TrustedParent,
        [string]$Path
    )
    $parentFull = Get-FoundationFullPath $TrustedParent
    $targetFull = Get-FoundationFullPath $Path
    if (-not (Test-FoundationPathContained -Parent $parentFull -Candidate $targetFull -AllowEqual)) {
        throw "PATH_OUTSIDE_ALLOWED_ROOT"
    }
    if (-not (Test-FoundationExistingPathChain -TrustedParent $parentFull -Candidate $targetFull)) {
        throw "PATH_REPARSE_POINT_REJECTED"
    }
    $missing = New-Object System.Collections.Generic.List[string]
    $probe = $targetFull
    while (-not (Test-Path -LiteralPath $probe)) {
        $missing.Add($probe)
        $next = Split-Path -Parent $probe
        if ([string]::IsNullOrWhiteSpace($next) -or $next -eq $probe) {
            throw "PATH_SAFE_CREATE_ANCESTOR_MISSING"
        }
        $probe = $next
    }
    for ($index = $missing.Count - 1; $index -ge 0; $index--) {
        if (-not (Test-FoundationExistingPathChain -TrustedParent $parentFull -Candidate $targetFull)) {
            throw "PATH_REPARSE_POINT_REJECTED"
        }
        [void][System.IO.Directory]::CreateDirectory($missing[$index])
        if (-not (Test-FoundationExistingPathChain -TrustedParent $parentFull -Candidate $targetFull)) {
            throw "PATH_REPARSE_POINT_REJECTED"
        }
    }
    return $targetFull
}

function Resolve-FoundationChildPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$TrustedParent,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$CandidateRelativePath,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$ExpectedLeaf
    )
    $result = [ordered]@{ allowed = $false; full_path = $null; error_code = $null; error_text = $null }
    try {
        $parentFull = Get-FoundationFullPath $TrustedParent
        if (-not [System.IO.Path]::IsPathRooted($parentFull)) {
            throw "Trusted parent is not absolute"
        }
        $segments = @($CandidateRelativePath -split '[\\/]')
        if ($segments -contains "..") {
            $result.error_code = "PATH_TRAVERSAL_REJECTED"
            $result.error_text = "Parent traversal is not allowed"
            return [pscustomobject]$result
        }
        if ([System.IO.Path]::IsPathRooted($CandidateRelativePath)) {
            $candidateFull = Get-FoundationFullPath $CandidateRelativePath
        }
        else {
            $candidateFull = Get-FoundationFullPath (Join-Path $parentFull $CandidateRelativePath)
        }
        $result.full_path = $candidateFull
        if (-not (Test-FoundationPathContained -Parent $parentFull -Candidate $candidateFull -AllowEqual)) {
            $result.error_code = "PATH_OUTSIDE_ALLOWED_ROOT"
            $result.error_text = "Candidate is outside the trusted parent"
            return [pscustomobject]$result
        }
        if (-not [string]::IsNullOrEmpty($ExpectedLeaf)) {
            $leaf = Split-Path -Leaf $candidateFull
            if (-not $leaf.Equals($ExpectedLeaf, [System.StringComparison]::OrdinalIgnoreCase)) {
                $result.error_code = "PATH_EXPECTED_LEAF_MISMATCH"
                $result.error_text = "Candidate leaf does not match the fixed leaf"
                return [pscustomobject]$result
            }
        }
        if (-not (Test-FoundationExistingPathChain -TrustedParent $parentFull -Candidate $candidateFull)) {
            $result.error_code = "PATH_REPARSE_POINT_REJECTED"
            $result.error_text = "Candidate traverses a reparse point"
            return [pscustomobject]$result
        }
        $result.allowed = $true
        return [pscustomobject]$result
    }
    catch {
        $result.error_code = "PATH_RESOLUTION_FAILED"
        $result.error_text = $_.Exception.Message
        return [pscustomobject]$result
    }
}

function Get-FoundationRelativePath {
    param([string]$Root, [string]$Path)
    $rootFull = Get-FoundationFullPath $Root
    $pathFull = Get-FoundationFullPath $Path
    if ($pathFull.Equals($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        return "."
    }
    $prefix = $rootFull + [System.IO.Path]::DirectorySeparatorChar
    if (-not $pathFull.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "PATH_OUTSIDE_ALLOWED_ROOT"
    }
    return $pathFull.Substring($prefix.Length).Replace("/", "\")
}

function Test-FoundationBusinessFileName {
    param([string]$Name)
    return $null -ne (Get-FoundationBusinessCandidateKind $Name)
}

function Get-FoundationBusinessCandidateKind {
    param([string]$Path)
    $leaf = [System.IO.Path]::GetFileName($Path)
    foreach ($suffix in @(
        ".sqlite3-journal", ".sqlite3-wal", ".sqlite3-shm",
        ".sqlite-journal", ".sqlite-wal", ".sqlite-shm",
        ".db-journal", ".db-wal", ".db-shm",
        ".jsonl.journal", ".jsonl.tmp"
    )) {
        if ($leaf.EndsWith($suffix, [System.StringComparison]::OrdinalIgnoreCase)) { return "sidecar" }
    }
    foreach ($suffix in @(".sqlite3", ".sqlite", ".jsonl", ".db")) {
        if ($leaf.EndsWith($suffix, [System.StringComparison]::OrdinalIgnoreCase)) { return "business" }
    }
    return $null
}

function Test-FoundationOpenClawInternalStateRelativePath {
    param([Parameter(Mandatory = $true)][string]$RelativePath)
    foreach ($allowed in @(
        "state\openclaw.sqlite",
        "state\openclaw.sqlite-wal",
        "state\openclaw.sqlite-shm",
        "state\openclaw.sqlite-journal"
    )) {
        if ($RelativePath.Equals($allowed, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $false
}

function New-FoundationSafeFileRecord {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Handle,
        [Parameter(Mandatory = $true)]$Info
    )
    if (($Info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0 -or
        ($Info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0) {
        throw "PATH_REPARSE_POINT_REJECTED:$Path"
    }
    $finalPath = ConvertFrom-FoundationFinalHandlePath ([string]$Info.FinalPath)
    if (-not $finalPath.Equals($Path, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "PATH_IDENTITY_CHANGED:$Path"
    }
    return [pscustomobject][ordered]@{
        Name = $Name
        FullName = $Path
        Length = [long]$Info.Length
        LastWriteTimeUtc = [datetime]$Info.LastWriteTimeUtc
        Sha256 = [FoundationValidationNativePath]::Sha256($Handle)
        VolumeSerial = [string]$Info.VolumeSerial
        FileId = [string]$Info.FileId
        Attributes = [uint32]$Info.Attributes
    }
}

function Invoke-FoundationSafeFileScan {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][bool]$ExcludeNodeModules,
        [Parameter(Mandatory = $true)][bool]$IncludeDist,
        [AllowNull()][scriptblock]$FilePredicate = $null,
        [string[]]$ExcludedSubtrees = @()
    )
    Initialize-FoundationNativePathType
    $rootFull = ConvertTo-FoundationStrictLocalPath $Root
    $excludedSubtreeSet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($excludedSubtree in @($ExcludedSubtrees)) {
        $excludedFull = ConvertTo-FoundationStrictLocalPath ([string]$excludedSubtree)
        if ((Test-FoundationPathEqual $rootFull $excludedFull) -or -not (Test-FoundationPathContained -Parent $rootFull -Candidate $excludedFull)) {
            throw "PATH_ROOT_RELATION_INVALID:manifest_excluded_subtree:$excludedFull"
        }
        if (-not $excludedSubtreeSet.Add($excludedFull)) { throw "PATH_ROOT_RELATION_INVALID:manifest_excluded_subtree_duplicate:$excludedFull" }
    }
    $excludedSubtreeList = @($excludedSubtreeSet)
    for ($leftIndex = 0; $leftIndex -lt $excludedSubtreeList.Count; $leftIndex++) {
        for ($rightIndex = $leftIndex + 1; $rightIndex -lt $excludedSubtreeList.Count; $rightIndex++) {
            if ((Test-FoundationPathContained -Parent ([string]$excludedSubtreeList[$leftIndex]) -Candidate ([string]$excludedSubtreeList[$rightIndex])) -or
                (Test-FoundationPathContained -Parent ([string]$excludedSubtreeList[$rightIndex]) -Candidate ([string]$excludedSubtreeList[$leftIndex]))) {
                throw "PATH_ROOT_RELATION_INVALID:manifest_excluded_subtree_overlap"
            }
        }
    }
    $files = New-Object System.Collections.ArrayList
    $rootPins = $null
    $rootHandle = $null
    try {
        $rootPins = New-FoundationPinnedPathChain -Path $rootFull -ShareWrite $false -AllowMissing $true
        if (@($rootPins.missing_paths).Count -ne 0) {
            return [pscustomobject][ordered]@{ path = $rootFull; exists = $false; files = @() }
        }
        $rootHandle = [FoundationValidationNativePath]::OpenImmutableRead($rootFull)
        $rootInfo = [FoundationValidationNativePath]::GetInfo($rootHandle)
        $rootFinal = ConvertFrom-FoundationFinalHandlePath ([string]$rootInfo.FinalPath)
        if (-not $rootFinal.Equals($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "PATH_IDENTITY_CHANGED:$rootFull"
        }
        if (($rootInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0) {
            throw "PATH_REPARSE_POINT_REJECTED:$rootFull"
        }
        $isDirectory = ($rootInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0
        if (-not $isDirectory) {
            $separator = $rootFull.LastIndexOf("\", [System.StringComparison]::Ordinal)
            if ($separator -lt 0 -or $separator -eq ($rootFull.Length - 1)) { throw "PATH_OPERATION_FAILED:invalid_file_leaf" }
            $rootName = $rootFull.Substring($separator + 1)
            if ($null -eq $FilePredicate -or [bool](& $FilePredicate $rootName $rootFull)) {
                [void]$files.Add((New-FoundationSafeFileRecord -Name $rootName -Path $rootFull -Handle $rootHandle -Info $rootInfo))
            }
        }
        else {
            $scanState = [pscustomobject]@{
                files = $files
                exclude_node_modules = $ExcludeNodeModules
                include_dist = $IncludeDist
                file_predicate = $FilePredicate
                excluded_subtrees = $excludedSubtreeSet
                excluded_subtrees_seen = (New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase))
            }
            $visitor = {
                param($Entry, $State)
                if ([bool]$Entry.is_reparse) { throw "PATH_REPARSE_POINT_REJECTED:$($Entry.path)" }
                if ([bool]$Entry.is_directory) { return }
                if ($null -ne $State.file_predicate -and -not [bool](& $State.file_predicate ([string]$Entry.name) ([string]$Entry.path))) { return }
                [void]$State.files.Add((New-FoundationSafeFileRecord -Name ([string]$Entry.name) -Path ([string]$Entry.path) -Handle $Entry.handle -Info $Entry.info))
            }
            $shouldDescend = {
                param($Entry, $State)
                if ([bool]$Entry.is_directory -and $State.excluded_subtrees.Contains([string]$Entry.path)) {
                    if (-not $State.excluded_subtrees_seen.Add([string]$Entry.path)) { throw "PATH_IDENTITY_CHANGED:$($Entry.path)" }
                    return $false
                }
                if ([bool]$State.exclude_node_modules -and ([string]$Entry.name).Equals("node_modules", [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
                if (-not [bool]$State.include_dist -and ([string]$Entry.name).Equals("dist", [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
                return $true
            }
            Invoke-FoundationHandleTreeDirectory -Root $rootFull -DirectoryPath $rootFull -DirectoryRelativePath "" -DirectoryHandle $rootHandle -Visitor $visitor -State $scanState -ShouldDescend $shouldDescend
            if ($scanState.excluded_subtrees_seen.Count -ne $scanState.excluded_subtrees.Count) {
                throw "PATH_IDENTITY_CHANGED:manifest_excluded_subtree_missing"
            }
        }
        return [pscustomobject][ordered]@{ path = $rootFull; exists = $true; files = @($files) }
    }
    finally {
        if ($null -ne $rootHandle) { $rootHandle.Dispose() }
        Close-FoundationPinSet $rootPins
    }
}

function Get-FoundationSafeFiles {
    param(
        [string]$Root,
        [bool]$ExcludeNodeModules,
        [bool]$IncludeDist
    )
    $scan = Invoke-FoundationSafeFileScan -Root $Root -ExcludeNodeModules $ExcludeNodeModules -IncludeDist $IncludeDist
    return @($scan.files)
}

function Invoke-FoundationDefaultManifestProvider {
    param($Request, $RootScans = $null, [string[]]$ExcludedSubtrees = @())
    $index = @{}
    $identityIndex = @{}
    $rootStates = New-Object System.Collections.ArrayList
    $rootSpecs = @($Request.roots)
    if (@($ExcludedSubtrees).Count -ne 0 -and $rootSpecs.Count -ne 1) { throw "PATH_ROOT_RELATION_INVALID:manifest_excluded_subtree_root_count" }
    $providedScans = @($RootScans)
    $useProvidedScans = $null -ne $RootScans
    if ($useProvidedScans -and $providedScans.Count -ne $rootSpecs.Count) { throw "PATH_IDENTITY_CHANGED:manifest_root_scan_count" }
    $filePredicate = $null
    if (-not [bool]$Request.all_files) {
        $filePredicate = { param($Name, $Path) return Test-FoundationBusinessFileName ([string]$Name) }
    }
    for ($rootIndex = 0; $rootIndex -lt $rootSpecs.Count; $rootIndex++) {
        $rootSpec = $rootSpecs[$rootIndex]
        $rootPath = Get-FoundationFullPath ([string]$rootSpec.path)
        if ($useProvidedScans) {
            $scan = $providedScans[$rootIndex]
            if ($null -eq $scan -or -not ([string]$scan.path).Equals($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "PATH_IDENTITY_CHANGED:$rootPath"
            }
        }
        else {
            $scan = Invoke-FoundationSafeFileScan -Root $rootPath -ExcludeNodeModules ([bool]$Request.exclude_node_modules) -IncludeDist ([bool]$Request.include_dist) -FilePredicate $filePredicate -ExcludedSubtrees $ExcludedSubtrees
        }
        [void]$rootStates.Add([pscustomobject]@{ root_id = [string]$rootSpec.root_id; path = $rootPath; exists = [bool]$scan.exists })
        if (-not [bool]$scan.exists) {
            continue
        }
        foreach ($file in @($scan.files)) {
            if (-not [bool]$Request.all_files -and -not (Test-FoundationBusinessFileName $file.Name)) {
                continue
            }
            $key = $file.FullName.ToUpperInvariant()
            if ($index.ContainsKey($key)) {
                $entry = $index[$key]
                $expectedIdentity = $identityIndex[$key]
                if ([long]$expectedIdentity.length -ne [long]$file.Length -or
                    [string]$expectedIdentity.sha256 -cne [string]$file.Sha256 -or
                    [string]$expectedIdentity.last_write_time_utc -cne $file.LastWriteTimeUtc.ToString("o") -or
                    [string]$expectedIdentity.volume_serial -cne [string]$file.VolumeSerial -or
                    [string]$expectedIdentity.file_id -cne [string]$file.FileId -or
                    [uint32]$expectedIdentity.attributes -ne [uint32]$file.Attributes) {
                    throw "PATH_IDENTITY_CHANGED:$($file.FullName)"
                }
                if (@($entry.root_labels) -notcontains [string]$rootSpec.root_id) {
                    $entry.root_labels = @($entry.root_labels) + @([string]$rootSpec.root_id)
                }
                continue
            }
            $relative = Get-FoundationRelativePath $rootPath $file.FullName
            $candidateKind = Get-FoundationBusinessCandidateKind $file.Name
            $classification = "other"
            if ($null -ne $candidateKind) {
                $classification = "business_candidate"
                if ([string]::Equals([string]$rootSpec.root_id, "openclaw_state_root", [System.StringComparison]::OrdinalIgnoreCase) -and
                    (Test-FoundationOpenClawInternalStateRelativePath $relative)) {
                    $classification = "openclaw_internal_tool_state"
                }
            }
            $creationStage = $null
            if ($null -ne $Request.PSObject.Properties["creation_stage_by_path"] -and $null -ne $Request.creation_stage_by_path) {
                if ($Request.creation_stage_by_path.ContainsKey($file.FullName)) {
                    $creationStage = [string]$Request.creation_stage_by_path[$file.FullName]
                }
            }
            if ([string]$Request.scope_id -ceq "openclaw_pre_delete_audit" -and [string]::IsNullOrWhiteSpace($creationStage)) {
                $creationStage = "post_command_unattributed"
            }
            $entry = [pscustomobject]@{
                full_path = $file.FullName
                relative_path = $relative
                root_labels = @([string]$rootSpec.root_id)
                length = [long]$file.Length
                sha256 = [string]$file.Sha256
                last_write_time_utc = $file.LastWriteTimeUtc.ToString("o")
                classification = $classification
                candidate_kind = $candidateKind
                creation_stage = $creationStage
            }
            $index[$key] = $entry
            $identityIndex[$key] = [pscustomobject][ordered]@{
                length = [long]$file.Length
                sha256 = [string]$file.Sha256
                last_write_time_utc = $file.LastWriteTimeUtc.ToString("o")
                volume_serial = [string]$file.VolumeSerial
                file_id = [string]$file.FileId
                attributes = [uint32]$file.Attributes
            }
        }
    }
    $entryKeys = New-Object 'System.Collections.Generic.List[string]'
    foreach ($key in @($index.Keys)) { $entryKeys.Add([string]$key) }
    $entryKeys.Sort([System.StringComparer]::OrdinalIgnoreCase)
    $entries = New-Object System.Collections.ArrayList
    foreach ($key in @($entryKeys)) { [void]$entries.Add($index[[string]$key]) }
    return [pscustomobject]@{ scope_id = [string]$Request.scope_id; roots = @($rootStates); entries = @($entries) }
}

function Add-FoundationManifestProviderReference {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.ArrayList]$SeenReferences,
        [AllowNull()]$Value,
        [Parameter(Mandatory = $true)][string]$Label
    )
    if ($null -eq $Value -or $Value -is [string] -or $Value.GetType().IsValueType) { return }
    foreach ($prior in @($SeenReferences)) {
        if ([object]::ReferenceEquals($prior, $Value)) {
            throw "MANIFEST_RESULT_IDENTITY_REUSED:$Label"
        }
    }
    [void]$SeenReferences.Add($Value)
}

function Copy-FoundationManifestProviderObjectValues {
    param(
        [AllowNull()]$Value,
        [Parameter(Mandatory = $true)][string[]]$ExpectedNames,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.ArrayList]$SeenReferences,
        [Parameter(Mandatory = $true)][string]$Label
    )
    if ($null -eq $Value -or -not ($Value -is [System.Management.Automation.PSCustomObject])) {
        throw "MANIFEST_RESULT_IDENTITY_INVALID:$Label"
    }
    Add-FoundationManifestProviderReference -SeenReferences $SeenReferences -Value $Value -Label $Label
    $properties = @($Value.PSObject.Properties)
    $expected = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    foreach ($name in $ExpectedNames) {
        if ([string]::IsNullOrWhiteSpace($name) -or -not $expected.Add($name)) {
            throw "MANIFEST_RESULT_IDENTITY_INVALID:$Label"
        }
    }
    $metadata = @{}
    foreach ($property in $properties) {
        if ($property.MemberType -ne [System.Management.Automation.PSMemberTypes]::NoteProperty) {
            throw "MANIFEST_PROVIDER_DYNAMIC_MEMBER:$Label.$($property.Name)"
        }
        $name = [string]$property.Name
        if (-not $expected.Contains($name) -or $metadata.ContainsKey($name)) {
            throw "MANIFEST_RESULT_IDENTITY_INVALID:$Label"
        }
        $metadata[$name] = $property
    }
    if ($metadata.Count -ne $ExpectedNames.Count) {
        throw "MANIFEST_RESULT_IDENTITY_INVALID:$Label"
    }
    $values = @{}
    foreach ($name in $ExpectedNames) {
        if (-not $metadata.ContainsKey($name)) { throw "MANIFEST_RESULT_IDENTITY_INVALID:$Label" }
        $values[$name] = $metadata[$name].Value
    }
    return $values
}

function Copy-FoundationManifestProviderCollection {
    param(
        [AllowNull()]$Value,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.ArrayList]$SeenReferences,
        [Parameter(Mandatory = $true)][string]$Label
    )
    if ($null -eq $Value) { throw "MANIFEST_RESULT_IDENTITY_INVALID:$Label" }
    Add-FoundationManifestProviderReference -SeenReferences $SeenReferences -Value $Value -Label $Label
    $valueType = [System.Object].GetMethod("GetType").Invoke($Value, $null)
    $allowedMembers = if ($Value -is [System.Array]) {
        @{
            Count = [System.Management.Automation.PSMemberTypes]::AliasProperty
            Length = [System.Management.Automation.PSMemberTypes]::Property
            LongLength = [System.Management.Automation.PSMemberTypes]::Property
            Rank = [System.Management.Automation.PSMemberTypes]::Property
            SyncRoot = [System.Management.Automation.PSMemberTypes]::Property
            IsReadOnly = [System.Management.Automation.PSMemberTypes]::Property
            IsFixedSize = [System.Management.Automation.PSMemberTypes]::Property
            IsSynchronized = [System.Management.Automation.PSMemberTypes]::Property
        }
    }
    elseif ($valueType -eq [System.Collections.ArrayList]) {
        @{
            Capacity = [System.Management.Automation.PSMemberTypes]::Property
            Count = [System.Management.Automation.PSMemberTypes]::Property
            IsFixedSize = [System.Management.Automation.PSMemberTypes]::Property
            IsReadOnly = [System.Management.Automation.PSMemberTypes]::Property
            IsSynchronized = [System.Management.Automation.PSMemberTypes]::Property
            SyncRoot = [System.Management.Automation.PSMemberTypes]::Property
        }
    }
    else { throw "MANIFEST_RESULT_IDENTITY_INVALID:$Label" }
    $properties = @($Value.PSObject.Properties)
    if ($properties.Count -ne @($allowedMembers.Keys).Count) { throw "MANIFEST_PROVIDER_DYNAMIC_MEMBER:$Label" }
    foreach ($property in $properties) {
        if (-not $allowedMembers.ContainsKey([string]$property.Name) -or $property.MemberType -ne $allowedMembers[[string]$property.Name]) {
            throw "MANIFEST_PROVIDER_DYNAMIC_MEMBER:$Label.$($property.Name)"
        }
    }
    $items = New-Object System.Collections.ArrayList
    if ($Value -is [System.Array]) {
        $arrayType = [System.Array]
        if ([int]$arrayType.GetProperty("Rank").GetValue($Value, $null) -ne 1) {
            throw "MANIFEST_RESULT_IDENTITY_INVALID:$Label"
        }
        $getLowerBound = $arrayType.GetMethod("GetLowerBound", [type[]]@([int]))
        $getUpperBound = $arrayType.GetMethod("GetUpperBound", [type[]]@([int]))
        $getValue = $arrayType.GetMethod("GetValue", [type[]]@([int]))
        $lower = [int]$getLowerBound.Invoke($Value, @([object]0))
        $upper = [int]$getUpperBound.Invoke($Value, @([object]0))
        for ($index = $lower; $index -le $upper; $index++) {
            [void]$items.Add($getValue.Invoke($Value, @([object]$index)))
        }
        return @($items)
    }
    if ($valueType -eq [System.Collections.ArrayList]) {
        $countProperty = [System.Collections.ICollection].GetProperty("Count")
        $itemProperty = [System.Collections.IList].GetProperty("Item")
        $count = [int]$countProperty.GetValue($Value, $null)
        for ($index = 0; $index -lt $count; $index++) {
            [void]$items.Add($itemProperty.GetValue($Value, @([object]$index)))
        }
        return @($items)
    }
    throw "MANIFEST_RESULT_IDENTITY_INVALID:$Label"
}

function Copy-FoundationManifestProviderResult {
    param(
        [AllowNull()]$Value,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.ArrayList]$SeenReferences
    )
    $top = Copy-FoundationManifestProviderObjectValues -Value $Value -ExpectedNames @("scope_id", "roots", "entries") -SeenReferences $SeenReferences -Label "top"
    if (-not ($top["scope_id"] -is [string])) { throw "MANIFEST_RESULT_IDENTITY_INVALID:scope_id" }

    $rootClones = New-Object System.Collections.ArrayList
    $rootIndex = 0
    foreach ($rootValue in @(Copy-FoundationManifestProviderCollection -Value $top["roots"] -SeenReferences $SeenReferences -Label "roots")) {
        $root = Copy-FoundationManifestProviderObjectValues -Value $rootValue -ExpectedNames @("root_id", "path", "exists") -SeenReferences $SeenReferences -Label "root[$rootIndex]"
        if (-not ($root["root_id"] -is [string]) -or -not ($root["path"] -is [string]) -or -not ($root["exists"] -is [bool])) {
            throw "MANIFEST_RESULT_IDENTITY_INVALID:root[$rootIndex]"
        }
        [void]$rootClones.Add([pscustomobject][ordered]@{ root_id = [string]$root["root_id"]; path = [string]$root["path"]; exists = [bool]$root["exists"] })
        $rootIndex++
    }

    $entryClones = New-Object System.Collections.ArrayList
    $entryIndex = 0
    foreach ($entryValue in @(Copy-FoundationManifestProviderCollection -Value $top["entries"] -SeenReferences $SeenReferences -Label "entries")) {
        $entry = Copy-FoundationManifestProviderObjectValues -Value $entryValue -ExpectedNames @("full_path", "relative_path", "root_labels", "length", "sha256", "last_write_time_utc", "classification", "candidate_kind", "creation_stage") -SeenReferences $SeenReferences -Label "entry[$entryIndex]"
        foreach ($name in @("full_path", "relative_path", "sha256", "last_write_time_utc", "classification")) {
            if (-not ($entry[$name] -is [string])) { throw "MANIFEST_ENTRY_INVALID:$entryIndex`:$name" }
        }
        foreach ($name in @("candidate_kind", "creation_stage")) {
            if ($null -ne $entry[$name] -and -not ($entry[$name] -is [string])) { throw "MANIFEST_ENTRY_INVALID:$entryIndex`:$name" }
        }
        if (-not ($entry["length"] -is [ValueType])) { throw "MANIFEST_ENTRY_INVALID:$entryIndex`:length" }
        $labelClones = New-Object System.Collections.ArrayList
        foreach ($rootLabel in @(Copy-FoundationManifestProviderCollection -Value $entry["root_labels"] -SeenReferences $SeenReferences -Label "entry[$entryIndex].root_labels")) {
            if (-not ($rootLabel -is [string])) { throw "MANIFEST_ENTRY_INVALID:$entryIndex`:root_labels" }
            [void]$labelClones.Add([string]$rootLabel)
        }
        [void]$entryClones.Add([pscustomobject][ordered]@{
            full_path = [string]$entry["full_path"]
            relative_path = [string]$entry["relative_path"]
            root_labels = @($labelClones)
            length = [long]$entry["length"]
            sha256 = [string]$entry["sha256"]
            last_write_time_utc = [string]$entry["last_write_time_utc"]
            classification = [string]$entry["classification"]
            candidate_kind = if ($null -eq $entry["candidate_kind"]) { $null } else { [string]$entry["candidate_kind"] }
            creation_stage = if ($null -eq $entry["creation_stage"]) { $null } else { [string]$entry["creation_stage"] }
        })
        $entryIndex++
    }
    return [pscustomobject][ordered]@{ scope_id = [string]$top["scope_id"]; roots = @($rootClones); entries = @($entryClones) }
}

function Test-FoundationCanonicalObservationField {
    param([AllowNull()][object]$Value, [bool]$AllowEmpty)
    $text = [string]$Value
    if (-not $AllowEmpty -and [string]::IsNullOrEmpty($text)) {
        return $false
    }
    return $text.IndexOf("|") -lt 0 -and $text.IndexOf("`r") -lt 0 -and $text.IndexOf("`n") -lt 0
}

function Get-FoundationOfficialObservationDigest {
    param($Observation)
    if ($null -eq $Observation -or [string]$Observation.schema_version -cne "official-state-observation/v1") {
        throw "OFFICIAL_OBSERVATION_SCHEMA_INVALID"
    }
    $routeOrder = @("A", "B", "C")
    $rootRows = @($Observation.roots)
    if ($rootRows.Count -ne 3) {
        throw "OFFICIAL_OBSERVATION_ROOTS_INVALID"
    }
    $records = New-Object 'System.Collections.Generic.List[string]'
    $records.Add("V|official-state-observation/v1")
    $rootStatus = @{}
    foreach ($routeIndex in 0..2) {
        $route = $routeOrder[$routeIndex]
        $row = $rootRows[$routeIndex]
        if ($null -eq $row -or [string]$row.route -cne $route) {
            throw "OFFICIAL_OBSERVATION_ROOTS_INVALID"
        }
        $rootPath = Get-FoundationFullPath ([string]$row.path)
        $status = [string]$row.scan_status
        if (@("scanned", "missing", "blocked", "unobserved") -cnotcontains $status) {
            throw "OFFICIAL_OBSERVATION_STATUS_INVALID"
        }
        $existsToken = "null"
        if ($null -ne $row.exists) {
            if ($row.exists -isnot [bool]) {
                throw "OFFICIAL_OBSERVATION_EXISTS_INVALID"
            }
            if ([bool]$row.exists) { $existsToken = "true" } else { $existsToken = "false" }
        }
        $errorCode = ""
        if ($null -ne $row.error_code) {
            $errorCode = [string]$row.error_code
        }
        if ($status -in @("scanned", "missing")) {
            if (-not [string]::IsNullOrEmpty($errorCode)) {
                throw "OFFICIAL_OBSERVATION_ERROR_CODE_INVALID"
            }
        }
        elseif ([string]::IsNullOrWhiteSpace($errorCode)) {
            throw "OFFICIAL_OBSERVATION_ERROR_CODE_INVALID"
        }
        foreach ($field in @($route, $rootPath, $status)) {
            if (-not (Test-FoundationCanonicalObservationField $field $false)) {
                throw "OFFICIAL_OBSERVATION_FIELD_INVALID"
            }
        }
        if (-not (Test-FoundationCanonicalObservationField $errorCode $true)) {
            throw "OFFICIAL_OBSERVATION_FIELD_INVALID"
        }
        $records.Add("R|$route|$rootPath|$existsToken|$status|$errorCode")
        $rootStatus[$route] = $status
    }

    $entryLines = @{
        A = New-Object 'System.Collections.Generic.List[string]'
        B = New-Object 'System.Collections.Generic.List[string]'
        C = New-Object 'System.Collections.Generic.List[string]'
    }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in @($Observation.entries)) {
        $route = [string]$entry.route
        if ($routeOrder -cnotcontains $route -or [string]$rootStatus[$route] -cne "scanned") {
            throw "OFFICIAL_OBSERVATION_ENTRY_ROUTE_INVALID"
        }
        $relative = [string]$entry.relative_path
        if (-not (Test-FoundationCanonicalObservationField $relative $false) -or
            [System.IO.Path]::IsPathRooted($relative) -or $relative.StartsWith("\") -or $relative.IndexOf("/") -ge 0) {
            throw "OFFICIAL_OBSERVATION_RELATIVE_PATH_INVALID"
        }
        foreach ($segment in @($relative -split '\\')) {
            if ([string]::IsNullOrEmpty($segment) -or $segment -eq "." -or $segment -eq "..") {
                throw "OFFICIAL_OBSERVATION_RELATIVE_PATH_INVALID"
            }
        }
        if (-not $seen.Add("$route|$relative")) {
            throw "OFFICIAL_OBSERVATION_ENTRY_DUPLICATE"
        }
        $length = [long]$entry.length
        if ($length -lt 0) {
            throw "OFFICIAL_OBSERVATION_LENGTH_INVALID"
        }
        $sha256 = [string]$entry.sha256
        $mtime = [string]$entry.last_write_time_utc
        if ($sha256 -cnotmatch '^[A-F0-9]{64}$' -or
            -not (Test-FoundationCanonicalObservationField $sha256 $false) -or
            -not (Test-FoundationCanonicalObservationField $mtime $false)) {
            throw "OFFICIAL_OBSERVATION_ENTRY_FIELD_INVALID"
        }
        $parsedMtime = [datetimeoffset]::MinValue
        if (-not [datetimeoffset]::TryParseExact($mtime, "o", [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsedMtime) -or
            $parsedMtime.Offset -ne [timespan]::Zero) {
            throw "OFFICIAL_OBSERVATION_MTIME_INVALID"
        }
        $lengthText = $length.ToString([System.Globalization.CultureInfo]::InvariantCulture)
        $entryLines[$route].Add("F|$route|$relative|$lengthText|$sha256|$mtime")
    }
    foreach ($route in $routeOrder) {
        $entryLines[$route].Sort([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($line in $entryLines[$route]) {
            $records.Add($line)
        }
    }
    return Get-FoundationSha256Text (@($records) -join "`n")
}

function Invoke-FoundationOfficialStateObservation {
    param(
        [string]$ScopeId,
        [string]$ProjectRoot,
        $OfficialRoots,
        [scriptblock]$ManifestInvoker,
        $ErrorSink
    )
    $rootRows = New-Object System.Collections.ArrayList
    $requestRoots = New-Object System.Collections.ArrayList
    $requestScans = New-Object System.Collections.ArrayList
    $projectRootFull = Get-FoundationFullPath $ProjectRoot
    $businessFilePredicate = { param($Name, $Path) return Test-FoundationBusinessFileName ([string]$Name) }
    foreach ($rootSpec in @($OfficialRoots)) {
        $route = [string]$rootSpec.route
        $rootPath = Get-FoundationFullPath ([string]$rootSpec.path)
        $pathError = $null
        if (-not (Test-FoundationPathContained -Parent $projectRootFull -Candidate $rootPath)) {
            $pathError = "PATH_OUTSIDE_ALLOWED_ROOT"
        }
        else {
            $separator = $rootPath.LastIndexOf("\", [System.StringComparison]::Ordinal)
            $leaf = if ($separator -ge 0 -and $separator -lt ($rootPath.Length - 1)) { $rootPath.Substring($separator + 1) } else { "" }
            if (-not $leaf.Equals("data", [System.StringComparison]::OrdinalIgnoreCase)) { $pathError = "PATH_EXPECTED_LEAF_MISMATCH" }
        }
        if ($null -ne $pathError) {
            [void]$rootRows.Add([pscustomobject][ordered]@{ route = $route; path = $rootPath; exists = $null; scan_status = "unobserved"; error_code = $pathError })
            continue
        }
        try { $scan = Invoke-FoundationSafeFileScan -Root $rootPath -ExcludeNodeModules $true -IncludeDist $true -FilePredicate $businessFilePredicate }
        catch {
            $errorCode = "OFFICIAL_ROOT_METADATA_FAILED"
            $status = "unobserved"
            $exists = $null
            $scanError = [string]$_.Exception.Message
            if ($scanError -like "PATH_REPARSE_POINT_REJECTED*") {
                $errorCode = "PATH_REPARSE_POINT_REJECTED"
                $status = "blocked"
                $reparsePrefix = "PATH_REPARSE_POINT_REJECTED:"
                if ($scanError.StartsWith($reparsePrefix, [System.StringComparison]::Ordinal)) {
                    $reparsePath = $scanError.Substring($reparsePrefix.Length)
                    try {
                        $reparseFull = ConvertTo-FoundationStrictLocalPath $reparsePath
                        if ($reparseFull.Equals($rootPath, [System.StringComparison]::OrdinalIgnoreCase) -or
                            (Test-FoundationPathContained -Parent $rootPath -Candidate $reparseFull)) {
                            $exists = $true
                        }
                    }
                    catch { }
                }
            }
            [void]$rootRows.Add([pscustomobject][ordered]@{ route = $route; path = $rootPath; exists = $exists; scan_status = $status; error_code = $errorCode })
            continue
        }
        if (-not [bool]$scan.exists) {
            [void]$rootRows.Add([pscustomobject][ordered]@{ route = $route; path = $rootPath; exists = $false; scan_status = "missing"; error_code = $null })
            continue
        }
        [void]$rootRows.Add([pscustomobject][ordered]@{ route = $route; path = $rootPath; exists = $true; scan_status = "scanned"; error_code = $null })
        [void]$requestRoots.Add([pscustomobject]@{ root_id = ("official_" + $route); path = $rootPath })
        [void]$requestScans.Add($scan)
    }

    $entries = New-Object System.Collections.ArrayList
    try {
        $request = [pscustomobject]@{ scope_id = $ScopeId; roots = @($requestRoots); exclude_node_modules = $true; include_dist = $true; all_files = $false }
        if ($null -eq $ManifestInvoker) { $manifest = Invoke-FoundationDefaultManifestProvider $request -RootScans @($requestScans) }
        else { $manifest = & $ManifestInvoker $request }
        foreach ($entry in @($manifest.entries)) {
            $fullPath = Get-FoundationFullPath ([string]$entry.full_path)
            $matchingRows = @($rootRows | Where-Object {
                [string]$_.scan_status -ceq "scanned" -and (Test-FoundationPathContained -Parent ([string]$_.path) -Candidate $fullPath)
            })
            if ($matchingRows.Count -ne 1) { throw "OFFICIAL_OBSERVATION_ENTRY_ROUTE_INVALID" }
            $row = $matchingRows[0]
            $relative = Get-FoundationRelativePath ([string]$row.path) $fullPath
            [void]$entries.Add([pscustomobject][ordered]@{
                route = [string]$row.route
                full_path = $fullPath
                relative_path = $relative
                root_labels = @("official_" + [string]$row.route)
                length = [long]$entry.length
                sha256 = ([string]$entry.sha256).ToUpperInvariant()
                last_write_time_utc = [string]$entry.last_write_time_utc
                classification = "business_candidate"
                candidate_kind = Get-FoundationBusinessCandidateKind $fullPath
                creation_stage = $entry.creation_stage
            })
        }
    }
    catch {
        foreach ($row in @($rootRows | Where-Object { [string]$_.scan_status -ceq "scanned" })) {
            $row.scan_status = "unobserved"
            $row.error_code = "manifest_failed"
        }
        $entries.Clear()
        if ($null -ne $ErrorSink) {
            [void]$ErrorSink.Add([pscustomobject]@{ code = "manifest_failed"; category = "manifest"; message = $_.Exception.ToString(); scope_id = $ScopeId })
        }
    }

    $coverageComplete = $true
    foreach ($row in @($rootRows)) {
        if ([string]$row.scan_status -notin @("scanned", "missing")) { $coverageComplete = $false }
    }
    $observation = [pscustomobject][ordered]@{
        schema_version = "official-state-observation/v1"
        scope_id = $ScopeId
        completed = $true
        coverage_complete = [bool]$coverageComplete
        state_digest = $null
        roots = @($rootRows)
        entries = @($entries)
    }
    try { $observation.state_digest = Get-FoundationOfficialObservationDigest $observation }
    catch {
        $observation.completed = $false
        $observation.coverage_complete = $false
        $observation.state_digest = $null
        if ($null -ne $ErrorSink) {
            [void]$ErrorSink.Add([pscustomobject]@{ code = "OFFICIAL_OBSERVATION_INVALID"; category = "manifest"; message = $_.Exception.ToString(); scope_id = $ScopeId })
        }
    }
    return $observation
}

function Invoke-FoundationProjectCandidateObservation {
    param(
        [string]$ScopeId,
        [string]$ProjectRoot,
        $ProjectRoots,
        [scriptblock]$ManifestInvoker,
        $ErrorSink
    )
    $rootRows = New-Object System.Collections.ArrayList
    $requestRoots = New-Object System.Collections.ArrayList
    $requestScans = New-Object System.Collections.ArrayList
    $projectRootFull = Get-FoundationFullPath $ProjectRoot
    $businessFilePredicate = { param($Name, $Path) return Test-FoundationBusinessFileName ([string]$Name) }
    foreach ($rootSpec in @($ProjectRoots)) {
        $rootId = [string]$rootSpec.root_id
        $rootPath = Get-FoundationFullPath ([string]$rootSpec.path)
        if (-not $rootPath.Equals($projectRootFull, [System.StringComparison]::OrdinalIgnoreCase) -and
            -not (Test-FoundationPathContained -Parent $projectRootFull -Candidate $rootPath)) {
            [void]$rootRows.Add([pscustomobject][ordered]@{ root_id = $rootId; path = $rootPath; exists = $null; scan_status = "unobserved"; error_code = "PATH_OUTSIDE_ALLOWED_ROOT" })
            continue
        }
        try { $scan = Invoke-FoundationSafeFileScan -Root $rootPath -ExcludeNodeModules $true -IncludeDist $true -FilePredicate $businessFilePredicate }
        catch {
            $errorCode = "PROJECT_ROOT_SCAN_FAILED"
            $status = "unobserved"
            if ($_.Exception.Message -like "PATH_REPARSE_POINT_REJECTED*") { $errorCode = "PATH_REPARSE_POINT_REJECTED"; $status = "blocked" }
            [void]$rootRows.Add([pscustomobject][ordered]@{ root_id = $rootId; path = $rootPath; exists = $null; scan_status = $status; error_code = $errorCode })
            if ($null -ne $ErrorSink) {
                [void]$ErrorSink.Add([pscustomobject]@{ code = $errorCode; category = "manifest"; message = $_.Exception.ToString(); scope_id = $ScopeId; root_id = $rootId })
            }
            continue
        }
        if (-not [bool]$scan.exists) {
            [void]$rootRows.Add([pscustomobject][ordered]@{ root_id = $rootId; path = $rootPath; exists = $false; scan_status = "missing"; error_code = $null })
            continue
        }
        [void]$rootRows.Add([pscustomobject][ordered]@{ root_id = $rootId; path = $rootPath; exists = $true; scan_status = "scanned"; error_code = $null })
        [void]$requestRoots.Add([pscustomobject]@{ root_id = $rootId; path = $rootPath })
        [void]$requestScans.Add($scan)
    }

    $entries = New-Object System.Collections.ArrayList
    try {
        $request = [pscustomobject]@{ scope_id = $ScopeId; roots = @($requestRoots); exclude_node_modules = $true; include_dist = $true; all_files = $false }
        if ($null -eq $ManifestInvoker) { $manifest = Invoke-FoundationDefaultManifestProvider $request -RootScans @($requestScans) }
        else { $manifest = & $ManifestInvoker $request }
        $index = @{}
        foreach ($entry in @($manifest.entries)) {
            $fullPath = Get-FoundationFullPath ([string]$entry.full_path)
            if (-not (Test-FoundationPathContained -Parent $ProjectRoot -Candidate $fullPath)) { throw "PROJECT_ENTRY_OUTSIDE_ROOT" }
            $kind = Get-FoundationBusinessCandidateKind $fullPath
            if ($null -eq $kind) { throw "PROJECT_ENTRY_NOT_BUSINESS_CANDIDATE" }
            $labels = New-Object 'System.Collections.Generic.List[string]'
            foreach ($row in @($rootRows)) {
                if ([string]$row.scan_status -cne "scanned") { continue }
                if (Test-FoundationPathContained -Parent ([string]$row.path) -Candidate $fullPath -AllowEqual) { $labels.Add([string]$row.root_id) }
            }
            $labels.Sort([System.StringComparer]::OrdinalIgnoreCase)
            if ($labels.Count -eq 0) { throw "PROJECT_ENTRY_ROOT_LABELS_EMPTY" }
            $key = $fullPath.ToUpperInvariant()
            $projectEntry = [pscustomobject][ordered]@{
                full_path = $fullPath
                relative_path = Get-FoundationRelativePath $ProjectRoot $fullPath
                root_labels = @($labels)
                length = [long]$entry.length
                sha256 = ([string]$entry.sha256).ToUpperInvariant()
                last_write_time_utc = [string]$entry.last_write_time_utc
                classification = "business_candidate"
                candidate_kind = $kind
                creation_stage = $entry.creation_stage
            }
            if ($index.ContainsKey($key)) {
                $existing = $index[$key]
                if ([long]$existing.length -ne [long]$projectEntry.length -or [string]$existing.sha256 -cne [string]$projectEntry.sha256 -or [string]$existing.last_write_time_utc -cne [string]$projectEntry.last_write_time_utc) {
                    throw "PROJECT_ENTRY_DUPLICATE_CONFLICT"
                }
            }
            else { $index[$key] = $projectEntry }
        }
        $entryKeys = New-Object 'System.Collections.Generic.List[string]'
        foreach ($key in @($index.Keys)) { $entryKeys.Add([string]$key) }
        $entryKeys.Sort([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($key in @($entryKeys)) { [void]$entries.Add($index[[string]$key]) }
    }
    catch {
        foreach ($row in @($rootRows | Where-Object { [string]$_.scan_status -ceq "scanned" })) {
            $row.scan_status = "unobserved"
            $row.error_code = "manifest_failed"
        }
        $entries.Clear()
        if ($null -ne $ErrorSink) {
            [void]$ErrorSink.Add([pscustomobject]@{ code = "manifest_failed"; category = "manifest"; message = $_.Exception.ToString(); scope_id = $ScopeId })
        }
    }
    $completed = $true
    foreach ($row in @($rootRows)) {
        if ([string]$row.scan_status -notin @("scanned", "missing")) { $completed = $false }
    }
    return [pscustomobject][ordered]@{ scope_id = $ScopeId; completed = [bool]$completed; roots = @($rootRows); entries = @($entries) }
}

function Get-FoundationProjectCandidateDiff {
    param($Before, $After)
    if ($null -eq $Before -or $null -eq $After -or -not [bool]$Before.completed -or -not [bool]$After.completed) {
        return [pscustomobject]@{ added = @(); modified = @(); deleted = @() }
    }
    return Get-FoundationManifestDiff $Before $After
}

function Set-FoundationSourceDistEntryClassification {
    param($Manifest)
    if ($null -eq $Manifest) { return $Manifest }
    foreach ($entry in @($Manifest.entries)) {
        $kind = Get-FoundationBusinessCandidateKind ([string]$entry.full_path)
        if ($null -eq $kind) { $entry.classification = "source_file" }
        else { $entry.classification = "business_candidate" }
        if ($null -eq $entry.PSObject.Properties["candidate_kind"]) { $entry | Add-Member -NotePropertyName candidate_kind -NotePropertyValue $kind }
        else { $entry.candidate_kind = $kind }
    }
    return $Manifest
}

function Copy-FoundationManifestObservation {
    param($Manifest, [bool]$Completed)
    $roots = New-Object System.Collections.ArrayList
    foreach ($root in @($Manifest.roots)) {
        [void]$roots.Add([pscustomobject][ordered]@{
            root_id = [string]$root.root_id
            path = [string]$root.path
            exists = [bool]$root.exists
        })
    }
    $entries = New-Object System.Collections.ArrayList
    foreach ($entry in @($Manifest.entries)) {
        $values = [ordered]@{}
        foreach ($property in @($entry.PSObject.Properties)) {
            if ([string]$property.Name -ceq "root_labels") { $values[$property.Name] = @($property.Value) }
            else { $values[$property.Name] = $property.Value }
        }
        [void]$entries.Add([pscustomobject]$values)
    }
    return [pscustomobject][ordered]@{
        scope_id = [string]$Manifest.scope_id
        completed = [bool]$Completed
        roots = @($roots)
        entries = @($entries)
    }
}

function Get-FoundationOfficialObservationDiff {
    param($Before, $After)
    $comparableRoutes = New-Object System.Collections.ArrayList
    foreach ($route in @("A", "B", "C")) {
        $beforeRow = @($Before.roots | Where-Object { [string]$_.route -ceq $route })
        $afterRow = @($After.roots | Where-Object { [string]$_.route -ceq $route })
        if ($beforeRow.Count -eq 1 -and $afterRow.Count -eq 1 -and
            [string]$beforeRow[0].scan_status -in @("scanned", "missing") -and
            [string]$afterRow[0].scan_status -in @("scanned", "missing")) {
            [void]$comparableRoutes.Add($route)
        }
    }
    $beforeComparable = [pscustomobject]@{ entries = @($Before.entries | Where-Object { $comparableRoutes -contains [string]$_.route }) }
    $afterComparable = [pscustomobject]@{ entries = @($After.entries | Where-Object { $comparableRoutes -contains [string]$_.route }) }
    return Get-FoundationManifestDiff $beforeComparable $afterComparable
}

function Test-FoundationOfficialAfterGenerated {
    param($Before, $After)
    if ($null -eq $After -or [object]::ReferenceEquals($Before, $After)) { return $false }
    if ([string]$After.schema_version -cne "official-state-observation/v1" -or
        [string]$After.scope_id -cne "official_after" -or
        -not ($After.completed -is [bool]) -or -not [bool]$After.completed -or
        [string]$After.state_digest -cnotmatch '^[A-F0-9]{64}$') {
        return $false
    }
    $rows = @($After.roots)
    if ($rows.Count -ne 3) { return $false }
    for ($index = 0; $index -lt 3; $index++) {
        if ([string]$rows[$index].route -cne @("A", "B", "C")[$index]) { return $false }
    }
    try { return [string]$After.state_digest -ceq [string](Get-FoundationOfficialObservationDigest $After) }
    catch { return $false }
}

function Get-FoundationManifestDiff {
    param($Before, $After)
    if (($null -ne $Before -and $null -ne $Before.PSObject.Properties["completed"] -and -not [bool]$Before.completed) -or
        ($null -ne $After -and $null -ne $After.PSObject.Properties["completed"] -and -not [bool]$After.completed)) {
        return [pscustomobject]@{ added = @(); modified = @(); deleted = @() }
    }
    $beforeIndex = @{}
    $afterIndex = @{}
    foreach ($entry in @($Before.entries)) { $beforeIndex[[string]$entry.full_path] = $entry }
    foreach ($entry in @($After.entries)) { $afterIndex[[string]$entry.full_path] = $entry }
    $added = New-Object System.Collections.ArrayList
    $modified = New-Object System.Collections.ArrayList
    $deleted = New-Object System.Collections.ArrayList
    foreach ($path in @($afterIndex.Keys | Sort-Object)) {
        if (-not $beforeIndex.ContainsKey($path)) {
            [void]$added.Add($afterIndex[$path])
            continue
        }
        $left = $beforeIndex[$path]
        $right = $afterIndex[$path]
        if ([long]$left.length -ne [long]$right.length -or [string]$left.sha256 -ne [string]$right.sha256 -or [string]$left.last_write_time_utc -ne [string]$right.last_write_time_utc) {
            [void]$modified.Add([pscustomobject]@{ full_path = $path; before = $left; after = $right })
        }
    }
    foreach ($path in @($beforeIndex.Keys | Sort-Object)) {
        if (-not $afterIndex.ContainsKey($path)) {
            [void]$deleted.Add($beforeIndex[$path])
        }
    }
    return [pscustomobject]@{ added = @($added); modified = @($modified); deleted = @($deleted) }
}

function Get-FoundationStateDigest {
    param($Before, $After)
    $afterIndex = @{}
    foreach ($entry in @($After.entries)) { $afterIndex[[string]$entry.full_path] = $entry }
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($beforeEntry in @($Before.entries | Sort-Object -Property full_path)) {
        $path = [string]$beforeEntry.full_path
        if ($afterIndex.ContainsKey($path)) {
            $entry = $afterIndex[$path]
            $lines.Add("$path|True|$($entry.length)|$($entry.sha256)|$($entry.last_write_time_utc)")
        }
        else {
            $lines.Add("$path|False|||")
        }
    }
    return Get-FoundationSha256Text (@($lines) -join "`n")
}

function Get-FoundationEnvironmentSnapshot {
    $entries = New-Object System.Collections.ArrayList
    $variables = [Environment]::GetEnvironmentVariables("Process")
    foreach ($name in @($variables.Keys | ForEach-Object { [string]$_ } | Sort-Object)) {
        [void]$entries.Add([pscustomobject]@{ name = $name; value = [string]$variables[$name] })
    }
    return [pscustomobject]@{ success = $true; entries = @($entries); error_type = $null; error_text = $null }
}

function Invoke-FoundationDefaultEnvironmentAdapter {
    param($Request)
    if ([string]$Request.operation -ne "snapshot" -or [string]$Request.scope -ne "process") {
        return [pscustomobject]@{ success = $false; entries = @(); error_type = "ENVIRONMENT_WRITE_FORBIDDEN"; error_text = "Only read-only process snapshots are supported" }
    }
    return Get-FoundationEnvironmentSnapshot
}

function Copy-FoundationEnvironmentSnapshot {
    param($Snapshot)
    Assert-FoundationExactPropertySet $Snapshot @("success", "entries", "error_type", "error_text") "ENVIRONMENT_SNAPSHOT_INVALID"
    if (-not ($Snapshot.success -is [bool])) { throw "ENVIRONMENT_SNAPSHOT_INVALID:success" }
    $entries = New-Object System.Collections.ArrayList
    $names = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in @($Snapshot.entries)) {
        Assert-FoundationExactPropertySet $entry @("name", "value") "ENVIRONMENT_SNAPSHOT_INVALID"
        if (-not ($entry.name -is [string]) -or -not ($entry.value -is [string]) -or [string]::IsNullOrWhiteSpace([string]$entry.name) -or -not $names.Add([string]$entry.name)) {
            throw "ENVIRONMENT_SNAPSHOT_INVALID:entry"
        }
        [void]$entries.Add([pscustomobject][ordered]@{ name = [string]$entry.name; value = [string]$entry.value })
    }
    $errorType = if ($null -eq $Snapshot.error_type) { $null } elseif ($Snapshot.error_type -is [string]) { [string]$Snapshot.error_type } else { throw "ENVIRONMENT_SNAPSHOT_INVALID:error_type" }
    $errorText = if ($null -eq $Snapshot.error_text) { $null } elseif ($Snapshot.error_text -is [string]) { [string]$Snapshot.error_text } else { throw "ENVIRONMENT_SNAPSHOT_INVALID:error_text" }
    if ([bool]$Snapshot.success -and (-not [string]::IsNullOrWhiteSpace($errorType) -or -not [string]::IsNullOrWhiteSpace($errorText))) { throw "ENVIRONMENT_SNAPSHOT_INVALID:success_error" }
    return [pscustomobject][ordered]@{ success = [bool]$Snapshot.success; entries = @($entries); error_type = $errorType; error_text = $errorText }
}

function Get-FoundationEnvironmentAuditView {
    param($Snapshot)
    if ($null -eq $Snapshot -or -not [bool]$Snapshot.success) {
        return [pscustomobject]@{ names = @(); value_hashes = @(); fingerprint = $null }
    }
    $rows = New-Object System.Collections.Generic.List[string]
    $names = New-Object System.Collections.ArrayList
    $hashes = New-Object System.Collections.ArrayList
    foreach ($entry in @($Snapshot.entries | Sort-Object -Property name)) {
        $name = [string]$entry.name
        $hash = Get-FoundationSha256Text ([string]$entry.value)
        [void]$names.Add($name)
        [void]$hashes.Add([pscustomobject]@{ name = $name; value_sha256 = $hash })
        $rows.Add($name.ToUpperInvariant() + "|" + $hash)
    }
    return [pscustomobject]@{ names = @($names); value_hashes = @($hashes); fingerprint = (Get-FoundationSha256Text (@($rows) -join "`n")) }
}

function New-FoundationCleanRoomPolicy {
    param([string]$ControlledRoot, [bool]$Plugin)
    $root = Get-FoundationFullPath $ControlledRoot
    $controlledHome = Join-Path $root "home"
    $appData = Join-Path $root "appdata"
    $localAppData = Join-Path $root "localappdata"
    $temp = Join-Path $root "temp"
    $drive = [System.IO.Path]::GetPathRoot($controlledHome).TrimEnd("\")
    $homePath = $controlledHome.Substring($drive.Length)
    $architecture = "x86"
    if ([Environment]::Is64BitOperatingSystem) { $architecture = "AMD64" }
    $username = [Environment]::UserName
    if ([string]::IsNullOrWhiteSpace($username) -or $username -notmatch '^[A-Za-z0-9._-]+$') { $username = "foundation-validator" }
    $values = [ordered]@{
        APPDATA = @($appData, "controlled_appdata")
        ComSpec = @("C:\Windows\System32\cmd.exe", "validated_system_path")
        HOME = @($controlledHome, "controlled_home")
        HOMEDRIVE = @($drive, "controlled_home_drive")
        HOMEPATH = @($homePath, "controlled_home_path")
        LOCALAPPDATA = @($localAppData, "controlled_localappdata")
        NODE_DISABLE_COMPILE_CACHE = @("1", "frozen_policy")
        NUMBER_OF_PROCESSORS = @([string][Environment]::ProcessorCount, "validated_system_scalar")
        OS = @("Windows_NT", "validated_system_scalar")
        PATH = @("C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0", "frozen_system_path")
        PATHEXT = @(".COM;.EXE;.BAT;.CMD", "validated_system_scalar")
        PROCESSOR_ARCHITECTURE = @($architecture, "validated_system_scalar")
        SystemRoot = @("C:\Windows", "validated_system_path")
        TEMP = @($temp, "controlled_temp")
        TMP = @($temp, "controlled_temp")
        TMPDIR = @($temp, "controlled_temp")
        USERNAME = @($username, "validated_system_scalar")
        USERPROFILE = @($controlledHome, "controlled_home")
        WINDIR = @("C:\Windows", "validated_system_path")
    }
    if ($Plugin) {
        $values["JITI_FS_CACHE"] = @("false", "frozen_plugin_policy")
        $values["OPENCLAW_CONFIG_PATH"] = @((Join-Path $root "openclaw.json"), "controlled_openclaw_config")
        $values["OPENCLAW_HOME"] = @($root, "controlled_openclaw_home")
        $values["OPENCLAW_STATE_DIR"] = @($root, "controlled_openclaw_state")
    }
    $entries = New-Object System.Collections.ArrayList
    foreach ($name in $values.Keys) {
        [void]$entries.Add([pscustomobject]@{ name = [string]$name; value = [string]$values[$name][0]; source = [string]$values[$name][1] })
    }
    return [pscustomobject]@{ inherit_environment = $false; exact_key_values = @($entries) }
}

function Initialize-FoundationCleanRoomDirectories {
    param([string]$ControlledRoot)
    $root = Get-FoundationFullPath $ControlledRoot
    foreach ($relative in @("home", "appdata", "localappdata", "temp")) {
        [void](New-FoundationSafeDirectory -TrustedParent $root -Path (Join-Path $root $relative))
    }
}

function New-FoundationRuntimeSnapshotIdentity {
    param(
        [Parameter(Mandatory = $true)]$Layout,
        [Parameter(Mandatory = $true)]$Runtime
    )
    $snapshotRoot = ConvertTo-FoundationStrictLocalPath ([string]$Layout.runtime_snapshot_root)
    $nodeRoot = ConvertTo-FoundationStrictLocalPath ([string]$Layout.runtime_snapshot_node_root)
    $pnpmRoot = ConvertTo-FoundationStrictLocalPath ([string]$Layout.runtime_snapshot_pnpm_root)
    $policyPath = ConvertTo-FoundationStrictLocalPath ([string]$Layout.runtime_policy_path)
    return [pscustomobject][ordered]@{
        root = $snapshotRoot
        node_root = $nodeRoot
        pnpm_root = $pnpmRoot
        policy_module_path = $policyPath
        policy_module_url = ([System.Uri]$policyPath).AbsoluteUri
        node_entry = Join-Path $nodeRoot "node-v24.15.0-win-x64\node.exe"
        vitest_entry = Join-Path $pnpmRoot "vitest@2.1.9_@types+node@26.2.0\node_modules\vitest\vitest.mjs"
        typescript_entry = Join-Path $pnpmRoot "typescript@5.9.3\node_modules\typescript\bin\tsc"
        openclaw_entry = Join-Path $pnpmRoot "openclaw@2026.7.1\node_modules\openclaw\openclaw.mjs"
        vitest_fork_entry = Join-Path $pnpmRoot "tinypool@1.1.1\node_modules\tinypool\dist\entry\process.js"
        rollup_addon = Join-Path $pnpmRoot "@rollup+rollup-win32-x64-msvc@4.62.4\node_modules\@rollup\rollup-win32-x64-msvc\rollup.win32-x64-msvc.node"
        esbuild_entry = Join-Path $pnpmRoot "@esbuild+win32-x64@0.21.5\node_modules\@esbuild\win32-x64\esbuild.exe"
        source_identity_expectations = $Runtime.identity_expectations
    }
}

function New-FoundationCommandEnvironmentPolicy {
    param(
        [Parameter(Mandatory = $true)][string]$ProfileRoot,
        [Parameter(Mandatory = $true)][bool]$Plugin,
        [AllowNull()][string]$OpenClawRoot = $null
    )
    $profileRootFull = ConvertTo-FoundationStrictLocalPath $ProfileRoot
    $profileHome = Join-Path $profileRootFull "home"
    $appData = Join-Path $profileRootFull "appdata\roaming"
    $localAppData = Join-Path $profileRootFull "appdata\local"
    $temp = Join-Path $profileRootFull "temp"
    $homeRoot = [System.IO.Path]::GetPathRoot($profileHome)
    $homeDrive = $homeRoot.TrimEnd("\", "/")
    $homePath = $profileHome.Substring($homeDrive.Length)
    $architecture = "x86"
    if ([Environment]::Is64BitOperatingSystem) { $architecture = "AMD64" }
    $username = [Environment]::UserName
    if ([string]::IsNullOrWhiteSpace($username) -or $username -notmatch '^[A-Za-z0-9._-]+$') {
        $username = "foundation-validator"
    }
    $values = [ordered]@{
        APPDATA = @($appData, "command_profile_literal")
        ComSpec = @("C:\Windows\System32\cmd.exe", "validated_system_literal")
        HOME = @($profileHome, "command_profile_literal")
        HOMEDRIVE = @($homeDrive, "command_profile_derived")
        HOMEPATH = @($homePath, "command_profile_derived")
        LOCALAPPDATA = @($localAppData, "command_profile_literal")
        NODE_DISABLE_COMPILE_CACHE = @("1", "contract_literal")
        NUMBER_OF_PROCESSORS = @([string][Environment]::ProcessorCount, "validated_host_scalar")
        OS = @("Windows_NT", "validated_system_literal")
        PATH = @("C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0", "contract_literal")
        PATHEXT = @(".COM;.EXE;.BAT;.CMD", "validated_system_literal")
        PROCESSOR_ARCHITECTURE = @($architecture, "validated_host_scalar")
        SystemRoot = @("C:\Windows", "validated_system_literal")
        TEMP = @($temp, "command_profile_literal")
        TMP = @($temp, "command_profile_literal")
        TMPDIR = @($temp, "command_profile_literal")
        USERNAME = @($username, "validated_host_scalar")
        USERPROFILE = @($profileHome, "command_profile_literal")
        WINDIR = @("C:\Windows", "validated_system_literal")
    }
    if ($Plugin) {
        if ([string]::IsNullOrWhiteSpace($OpenClawRoot)) { throw "COMMAND_SPEC_INVALID" }
        $openClawRootFull = ConvertTo-FoundationStrictLocalPath $OpenClawRoot
        $values["JITI_FS_CACHE"] = @("false", "contract_literal")
        $values["OPENCLAW_CONFIG_PATH"] = @((Join-Path $openClawRootFull "openclaw.json"), "contract_literal")
        $values["OPENCLAW_HOME"] = @($openClawRootFull, "contract_literal")
        $values["OPENCLAW_STATE_DIR"] = @($openClawRootFull, "contract_literal")
    }
    $entries = New-Object System.Collections.ArrayList
    foreach ($name in $values.Keys) {
        [void]$entries.Add([pscustomobject][ordered]@{
            name = [string]$name
            value = [string]$values[$name][0]
            source = [string]$values[$name][1]
        })
    }
    return [pscustomobject][ordered]@{
        inherit_environment = $false
        profile = [pscustomobject][ordered]@{
            root = $profileRootFull
            home = $profileHome
            appdata = $appData
            localappdata = $localAppData
            temp = $temp
        }
        parent_environment = [pscustomobject][ordered]@{ exact_key_values = @($entries) }
        derived_child_environment = [pscustomobject][ordered]@{
            authority = "policy_module"
            caller_values_allowed = $false
            incoming_request_env = $null
            q_supplied_env = $null
            source_derived_createprocess_env = $null
            bootstrap_visible_env = $null
            observations = @()
        }
    }
}

function New-FoundationPermissionModel {
    param(
        [Parameter(Mandatory = $true)][string[]]$ReadRoots,
        [Parameter(Mandatory = $true)][string]$WriteRoot,
        [Parameter(Mandatory = $true)][bool]$TestCommand
    )
    $normalizedReads = @($ReadRoots | ForEach-Object { ConvertTo-FoundationStrictLocalPath ([string]$_) })
    $normalizedWrite = ConvertTo-FoundationStrictLocalPath $WriteRoot
    $arguments = New-Object System.Collections.ArrayList
    [void]$arguments.Add("--permission")
    foreach ($root in $normalizedReads) { [void]$arguments.Add("--allow-fs-read=$root") }
    [void]$arguments.Add("--allow-fs-write=$normalizedWrite")
    if ($TestCommand) {
        [void]$arguments.Add("--allow-child-process")
        [void]$arguments.Add("--allow-addons")
    }
    return [pscustomobject][ordered]@{
        enabled = $true
        argument_vector = @($arguments)
        fs_read_roots = @($normalizedReads)
        fs_write_roots = @($normalizedWrite)
        allow_worker = $false
        allow_child_process = $TestCommand
        allow_addons = $TestCommand
        allow_wasi = $false
    }
}

function New-FoundationNodeRuntimePolicy {
    param(
        [Parameter(Mandatory = $true)]$PermissionModel,
        [Parameter(Mandatory = $true)]$SnapshotIdentity,
        [Parameter(Mandatory = $true)][bool]$Plugin
    )
    $runtimeArguments = @("--no-global-search-paths", ("--import=" + [string]$SnapshotIdentity.policy_module_url))
    if ($Plugin) { $runtimeArguments += "--stack-size=8192" }
    return [pscustomobject][ordered]@{
        argument_vector = @($runtimeArguments)
        derived_node_prefix = @($PermissionModel.argument_vector) + @($runtimeArguments)
        no_global_search_paths = $true
        policy_module_path = [string]$SnapshotIdentity.policy_module_path
        policy_module_url = [string]$SnapshotIdentity.policy_module_url
        policy_module_sha256 = $script:FoundationFrozenPolicySha256
    }
}

function New-FoundationExecutionTopology {
    param(
        [Parameter(Mandatory = $true)][bool]$TestCommand,
        [Parameter(Mandatory = $true)]$SnapshotIdentity,
        [Parameter(Mandatory = $true)][string]$AttestationRoot
    )
    $allowed = @()
    if ($TestCommand) {
        $allowed = @([string]$SnapshotIdentity.node_entry, [string]$SnapshotIdentity.esbuild_entry)
    }
    return [pscustomobject][ordered]@{
        pool = if ($TestCommand) { "forks" } else { $null }
        single_fork = $TestCommand
        file_parallelism = $false
        allowed_descendant_executables = @($allowed)
        policy_attestation_root = ConvertTo-FoundationStrictLocalPath $AttestationRoot
        completion_telemetry_best_effort = $true
        job_accounting_required = $true
    }
}

function New-FoundationDisabledPermissionModel {
    return [pscustomobject][ordered]@{
        enabled = $false
        argument_vector = @()
        fs_read_roots = @()
        fs_write_roots = @()
        allow_worker = $false
        allow_child_process = $false
        allow_addons = $false
        allow_wasi = $false
    }
}

function New-FoundationCommandSpecifications {
    param(
        [Parameter(Mandatory = $true)]$Layout,
        [Parameter(Mandatory = $true)]$Runtime,
        [Parameter(Mandatory = $true)]$SnapshotIdentity
    )
    $specs = New-Object System.Collections.ArrayList
    $aExecutable = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
    $aScript = Join-Path $Layout.route_roots.A "tests\validate-foundation.ps1"
    $aIdentity = Get-FoundationObjectValue $Runtime.identity_expectations "a_structure"
    if ($null -ne $aIdentity) {
        $configuredExecutable = Get-FoundationObjectValue $aIdentity "executable_path"
        $configuredScript = Get-FoundationObjectValue $aIdentity "script_path"
        if (-not [string]::IsNullOrWhiteSpace([string]$configuredExecutable)) { $aExecutable = ConvertTo-FoundationStrictLocalPath ([string]$configuredExecutable) }
        if (-not [string]::IsNullOrWhiteSpace([string]$configuredScript)) { $aScript = ConvertTo-FoundationStrictLocalPath ([string]$configuredScript) }
    }
    $aCwd = Join-Path $Layout.validation_root "A"
    [void]$specs.Add([pscustomobject][ordered]@{
        id = "A.structure"
        route = "A"
        stage = "structure"
        cwd = $aCwd
        executable = $aExecutable
        arguments = @("-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", $aScript)
        staging_root = $null
        runtime_snapshot_root = $null
        module_resolution_roots = @()
        permission_model = New-FoundationDisabledPermissionModel
        node_runtime = $null
        execution_topology = $null
        environment_policy = New-FoundationCommandEnvironmentPolicy -ProfileRoot $aCwd -Plugin $false
    })

    foreach ($route in @("B", "C")) {
        $validationRoute = Join-Path $Layout.validation_root $route
        $buildRoute = Join-Path $Layout.build_root $route
        $staging = Join-Path $buildRoute "staging"
        $typebox = Join-Path $staging "node_modules\typebox"
        foreach ($stageDefinition in @(
            [pscustomobject]@{ id = "$route.test"; stage = "test"; plugin = $false },
            [pscustomobject]@{ id = "$route.build"; stage = "build"; plugin = $false },
            [pscustomobject]@{ id = "$route.plugin_build_check"; stage = "plugin_build_check"; plugin = $true },
            [pscustomobject]@{ id = "$route.plugin_validate"; stage = "plugin_validate"; plugin = $true }
        )) {
            $isTest = [string]$stageDefinition.stage -ceq "test"
            $isBuild = [string]$stageDefinition.stage -ceq "build"
            $isPlugin = [bool]$stageDefinition.plugin
            if ($isTest) {
                $readRoots = @($staging, $SnapshotIdentity.root, $validationRoute)
                $writeRoot = $validationRoute
                $toolEntry = [string]$SnapshotIdentity.vitest_entry
                $toolArguments = @("run", "--no-cache", "--pool=forks", "--poolOptions.forks.singleFork", "--no-file-parallelism")
            }
            elseif ($isBuild) {
                $readRoots = @($staging, $SnapshotIdentity.root, $validationRoute, $buildRoute)
                $writeRoot = $buildRoute
                $toolEntry = [string]$SnapshotIdentity.typescript_entry
                $toolArguments = @("-p", (Join-Path $staging "tsconfig.json"), "--outDir", (Join-Path $staging "dist"))
            }
            else {
                $readRoots = @($staging, $SnapshotIdentity.root, $Layout.openclaw_state_root)
                $writeRoot = [string]$Layout.openclaw_state_root
                $toolEntry = [string]$SnapshotIdentity.openclaw_entry
                $pluginVerb = if ([string]$stageDefinition.stage -ceq "plugin_build_check") { "build" } else { "validate" }
                $toolArguments = @("plugins", $pluginVerb, "--root", $staging, "--entry", "./dist/index.js")
            }
            $profileRoot = Join-Path $writeRoot ("environment\" + [string]$stageDefinition.id)
            $environmentPolicy = New-FoundationCommandEnvironmentPolicy -ProfileRoot $profileRoot -Plugin $isPlugin -OpenClawRoot ([string]$Layout.openclaw_state_root)
            $permission = New-FoundationPermissionModel -ReadRoots $readRoots -WriteRoot $writeRoot -TestCommand $isTest
            $nodeRuntime = New-FoundationNodeRuntimePolicy -PermissionModel $permission -SnapshotIdentity $SnapshotIdentity -Plugin $isPlugin
            $attestationRoot = Join-Path ([string]$environmentPolicy.profile.temp) "foundation-policy-attestations"
            $topology = New-FoundationExecutionTopology -TestCommand $isTest -SnapshotIdentity $SnapshotIdentity -AttestationRoot $attestationRoot
            [void]$specs.Add([pscustomobject][ordered]@{
                id = [string]$stageDefinition.id
                route = $route
                stage = [string]$stageDefinition.stage
                cwd = $staging
                executable = [string]$SnapshotIdentity.node_entry
                arguments = @($nodeRuntime.derived_node_prefix) + @($toolEntry) + @($toolArguments)
                staging_root = $staging
                runtime_snapshot_root = [string]$SnapshotIdentity.root
                module_resolution_roots = @($staging, $typebox, [string]$SnapshotIdentity.pnpm_root)
                permission_model = $permission
                node_runtime = $nodeRuntime
                execution_topology = $topology
                environment_policy = $environmentPolicy
            })
        }
    }
    return @($specs)
}

function New-FoundationCommandProfileReportRows {
    param($Specifications, $Layout)

    if ($null -eq $Specifications) { return @() }
    $items = @($Specifications)
    if ($items.Count -eq 0) { return @() }
    if ($items.Count -ne 9 -or $null -eq $Layout) { throw "COMMAND_SPEC_INVALID" }

    $expectedIds = @(
        "A.structure",
        "B.test", "B.build", "B.plugin_build_check", "B.plugin_validate",
        "C.test", "C.build", "C.plugin_build_check", "C.plugin_validate"
    )
    $rows = New-Object System.Collections.ArrayList
    for ($index = 0; $index -lt $items.Count; $index++) {
        $spec = $items[$index]
        if ([string]$spec.id -cne [string]$expectedIds[$index]) { throw "COMMAND_SPEC_INVALID" }
        if ($null -eq $spec.environment_policy -or $null -eq $spec.environment_policy.profile) { throw "COMMAND_SPEC_INVALID" }

        $profile = $spec.environment_policy.profile
        $stage = [string]$spec.stage
        $writeRoot = $null
        $cleanupRootId = $null
        if ([string]$spec.id -ceq "A.structure") {
            $writeRoot = [string]$Layout.validation_root
            $cleanupRootId = "validation_root"
        }
        else {
            $writeRoots = @($spec.permission_model.fs_write_roots)
            if ($writeRoots.Count -ne 1) { throw "COMMAND_SPEC_INVALID" }
            $writeRoot = [string]$writeRoots[0]
            if ($stage -ceq "test") { $cleanupRootId = "validation_root" }
            elseif ($stage -ceq "build") { $cleanupRootId = "build_root" }
            elseif ($stage -in @("plugin_build_check", "plugin_validate")) { $cleanupRootId = "openclaw_state_root" }
            else { throw "COMMAND_SPEC_INVALID" }
        }

        $derivedAttestationRoot = Join-Path ([string]$profile.temp) "foundation-policy-attestations"
        $attestationRoot = $derivedAttestationRoot
        if ($null -ne $spec.execution_topology -and -not [string]::IsNullOrWhiteSpace([string]$spec.execution_topology.policy_attestation_root)) {
            $attestationRoot = [string]$spec.execution_topology.policy_attestation_root
        }
        if (-not (Get-FoundationFullPath $attestationRoot).Equals((Get-FoundationFullPath $derivedAttestationRoot), [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "COMMAND_SPEC_INVALID"
        }

        [void]$rows.Add([pscustomobject][ordered]@{
            command_id = [string]$spec.id
            route = [string]$spec.route
            stage = $stage
            write_root = $writeRoot
            root = [string]$profile.root
            home = [string]$profile.home
            appdata = [string]$profile.appdata
            localappdata = [string]$profile.localappdata
            temp = [string]$profile.temp
            attestation_root = $attestationRoot
            audited_before_cleanup = $true
            cleanup_root_id = $cleanupRootId
        })
    }
    return @($rows)
}

function Initialize-FoundationCommandProfileDirectories {
    param([Parameter(Mandatory = $true)]$Spec)
    $paths = @(
        [string]$Spec.environment_policy.profile.root,
        [string]$Spec.environment_policy.profile.home,
        [string]$Spec.environment_policy.profile.appdata,
        [string]$Spec.environment_policy.profile.localappdata,
        [string]$Spec.environment_policy.profile.temp
    )
    if ($null -ne $Spec.execution_topology) {
        $paths += [string]$Spec.execution_topology.policy_attestation_root
    }
    foreach ($path in $paths) {
        $pins = New-FoundationPinnedDirectory -Path $path -OperationId ("command_profile_" + [string]$Spec.id)
        Close-FoundationPinSet $pins
    }
}

function Get-FoundationFrozenNetworkHookSet {
    $hooks = New-Object System.Collections.ArrayList
    foreach ($group in @(
        [pscustomobject]@{ prefix = "node:net"; names = @("connect", "createConnection", "createServer") },
        [pscustomobject]@{ prefix = "node:http"; names = @("request", "get", "createServer") },
        [pscustomobject]@{ prefix = "node:https"; names = @("request", "get", "createServer") },
        [pscustomobject]@{ prefix = "node:http2"; names = @("connect", "createServer", "createSecureServer", "performServerHandshake") },
        [pscustomobject]@{ prefix = "node:tls"; names = @("connect", "createServer") },
        [pscustomobject]@{ prefix = "node:dgram"; names = @("createSocket") }
    )) {
        foreach ($name in $group.names) { [void]$hooks.Add([string]$group.prefix + "." + [string]$name) }
    }
    $dnsNames = @("lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTlsa", "resolveTxt", "reverse", "setServers")
    foreach ($name in $dnsNames) {
        [void]$hooks.Add("node:dns." + $name)
        [void]$hooks.Add("node:dns/promises." + $name)
    }
    foreach ($value in @(
        "node:net.Socket.prototype.connect", "node:net.Server.prototype.listen",
        "node:http.Agent.prototype.createConnection", "node:https.Agent.prototype.createConnection",
        "node:tls.TLSSocket.prototype.connect", "node:dgram.Socket.prototype.bind",
        "node:dgram.Socket.prototype.connect", "node:dgram.Socket.prototype.send"
    )) { [void]$hooks.Add($value) }
    $resolverNames = @("cancel", "getServers", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTlsa", "resolveTxt", "reverse", "setLocalAddress", "setServers")
    foreach ($name in $resolverNames) {
        [void]$hooks.Add("node:dns.Resolver.prototype." + $name)
        [void]$hooks.Add("node:dns/promises.Resolver.prototype." + $name)
    }
    [void]$hooks.Add("globalThis.fetch")
    [void]$hooks.Add("globalThis.WebSocket")
    return @($hooks)
}

function New-FoundationPolicyBootstrapReport {
    param([Parameter(Mandatory = $true)]$PolicyModule)
    return [pscustomobject][ordered]@{
        schema_version = "foundation-trusted-policy/v2"
        path = [string]$PolicyModule.path
        module_url = [string]$PolicyModule.module_url
        line_count = [int]$PolicyModule.line_count
        length = [int]$PolicyModule.length
        sha256 = [string]$PolicyModule.sha256
        ascii_only = $true
        derived_node_prefixes = @()
        network_hook_set = @(Get-FoundationFrozenNetworkHookSet)
        network_not_present = @("globalThis.EventSource")
        network_self_tests_passed = $true
        sqlite_controls = [pscustomobject][ordered]@{
            cjs_esm_exports_synchronized = $true
            native_constructor_private = $true
            public_prototype_constructor_guarded = $true
            native_prototype_constructor_guarded = $true
            allow_extension = $false
            defensive = $true
            attach_limit = 0
            authorizer_attach_denied = $true
            backup_denied = $true
            sql_guarded_entry_points = @("exec", "prepare")
            self_tests_passed = $true
        }
        child_invocation_policy = [pscustomobject][ordered]@{
            roles = @("vitest_single_fork", "snapshot_node_helper", "esbuild")
            prototype_spawn_one_shot = $true
            vitest_staging_env_files = 0
            vite_user_env = [pscustomobject]@{}
            vitest_config_env = [pscustomobject]@{}
            fork_environment_layers = [pscustomobject][ordered]@{
                incoming_request_env = "parent19+five+BASE_URL/MODE/DEV/PROD"
                q_supplied_env = "parent19+five"
                source_derived_createprocess_env = "q supplied+NODE_CHANNEL_FD/NODE_CHANNEL_SERIALIZATION_MODE"
                bootstrap_visible_env = "child Q observed parent19+five"
            }
            fork_ipc_derivation = [pscustomobject][ordered]@{ effective_stdio = @("pipe", "pipe", "pipe", "ipc"); fd = "3"; serialization = "json"; observed = $false }
            source_derived_node_options_by_role = [pscustomobject][ordered]@{ vitest_single_fork = $null; snapshot_node_helper = $null; esbuild = "canonical permission flags" }
            sync_esbuild_forbidden = $true
        }
        addon_policy = [pscustomobject][ordered]@{
            exact_two_argument_dlopen = $true
            accepted_path_kinds = @("ordinary_drive", "namespaced_drive")
            native_original_path_passthrough = $true
            allowed = @([pscustomobject][ordered]@{
                relative_path = "pnpm\@rollup+rollup-win32-x64-msvc@4.62.4\node_modules\@rollup\rollup-win32-x64-msvc\rollup.win32-x64-msvc.node"
                length = 2623488
                sha256 = "397EF6F183536E03ADB15653ACC34660245881A74B3C248DB06DF8FF3C4C6B49"
            })
            actual_loaded = @()
        }
        policy_ready = @()
        spawn_intents = @()
        spawn_results = @()
        addon_loads = @()
        installed_fail_closed = $true
    }
}

function ConvertTo-FoundationWindowsArgument {
    param([AllowEmptyString()][string]$Argument)
    if ($Argument.Length -eq 0) { return '""' }
    if ($Argument -notmatch '[\s"]') { return $Argument }
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $slashes = 0
    foreach ($character in $Argument.ToCharArray()) {
        if ($character -eq '\') {
            $slashes++
            continue
        }
        if ($character -eq '"') {
            if ($slashes -gt 0) { [void]$builder.Append(('\' * ($slashes * 2))) }
            [void]$builder.Append('\"')
            $slashes = 0
            continue
        }
        if ($slashes -gt 0) { [void]$builder.Append(('\' * $slashes)); $slashes = 0 }
        [void]$builder.Append($character)
    }
    if ($slashes -gt 0) { [void]$builder.Append(('\' * ($slashes * 2))) }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Get-FoundationAsyncStreamCaptureSource {
    return @'
using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;

public sealed class FoundationValidationAsyncStreamCapture
{
    private readonly object sync = new object();
    private readonly StringBuilder builder = new StringBuilder();
    public Task Completion { get; private set; }
    public string ErrorText { get; private set; }

    public FoundationValidationAsyncStreamCapture(TextReader reader)
    {
        Completion = Drain(reader);
    }

    private async Task Drain(TextReader reader)
    {
        try
        {
            char[] buffer = new char[4096];
            while (true)
            {
                int count = await reader.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false);
                if (count <= 0) { break; }
                lock (sync) { builder.Append(buffer, 0, count); }
            }
        }
        catch (Exception error)
        {
            ErrorText = error.ToString();
            throw;
        }
    }

    public string Snapshot()
    {
        lock (sync) { return builder.ToString(); }
    }

    public static bool WaitBoth(FoundationValidationAsyncStreamCapture first, FoundationValidationAsyncStreamCapture second, int timeoutMilliseconds)
    {
        try
        {
            return Task.WaitAll(new Task[] { first.Completion, second.Completion }, timeoutMilliseconds);
        }
        catch (AggregateException)
        {
            return true;
        }
    }
}
'@
}

function Get-FoundationNativeProcessSource {
    return @'
public sealed class FoundationNativeCompletionMessage
{
    public int ProcessId { get; set; }
    public long StartTimeFileTimeUtc { get; set; }
    public string ExecutablePath { get; set; }
    public long Length { get; set; }
    public string Sha256 { get; set; }
    public string FirstEvent { get; set; }
    public string LastEvent { get; set; }
    public bool ExitObserved { get; set; }
    public string IdentityError { get; set; }
}

public sealed class FoundationNativeJobAccounting
{
    public uint TotalProcesses { get; set; }
    public uint ActiveProcesses { get; set; }
    public uint TotalTerminatedProcesses { get; set; }
}

public sealed class FoundationNativeJobSnapshot
{
    public FoundationNativeJobAccounting Accounting { get; set; }
    public FoundationNativeCompletionMessage[] Messages { get; set; }
    public bool ActiveZeroObserved { get; set; }
    public string CompletionError { get; set; }
}

public sealed class FoundationValidationNativeProcessSession : IDisposable
{
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const uint STARTF_USESTDHANDLES = 0x00000100;
    private const uint HANDLE_FLAG_INHERIT = 0x00000001;
    private const uint GENERIC_READ = 0x80000000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint OPEN_EXISTING = 3;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    private const uint SYNCHRONIZE = 0x00100000;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const int JobObjectAssociateCompletionPortInformation = 7;
    private const int JobObjectExtendedLimitInformation = 9;
    private const int JobObjectBasicAccountingInformation = 1;
    private const uint JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO = 4;
    private const uint JOB_OBJECT_MSG_NEW_PROCESS = 6;
    private const uint JOB_OBJECT_MSG_EXIT_PROCESS = 7;
    private const uint JOB_OBJECT_MSG_ABNORMAL_EXIT_PROCESS = 8;
    private const uint WAIT_OBJECT_0 = 0;
    private const uint WAIT_TIMEOUT = 258;
    private const uint STILL_ACTIVE = 259;

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME_NATIVE
    {
        public uint dwLowDateTime;
        public uint dwHighDateTime;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_ASSOCIATE_COMPLETION_PORT
    {
        public IntPtr CompletionKey;
        public IntPtr CompletionPort;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public long TotalUserTime;
        public long TotalKernelTime;
        public long ThisPeriodTotalUserTime;
        public long ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount;
        public uint TotalProcesses;
        public uint ActiveProcesses;
        public uint TotalTerminatedProcesses;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreatePipe(out IntPtr readPipe, out IntPtr writePipe, ref SECURITY_ATTRIBUTES pipeAttributes, uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFileW(string path, uint access, uint share, IntPtr securityAttributes, uint creationDisposition, uint flags, IntPtr templateFile);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessW(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint informationLength, out uint returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateIoCompletionPort(IntPtr fileHandle, IntPtr existingCompletionPort, UIntPtr completionKey, uint numberOfConcurrentThreads);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetQueuedCompletionStatus(IntPtr completionPort, out uint numberOfBytes, out UIntPtr completionKey, out IntPtr overlapped, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool PostQueuedCompletionStatus(IntPtr completionPort, uint numberOfBytes, UIntPtr completionKey, IntPtr overlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(IntPtr process, out FILETIME_NATIVE creation, out FILETIME_NATIVE exit, out FILETIME_NATIVE kernel, out FILETIME_NATIVE user);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder path, ref uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    private readonly object sync = new object();
    private readonly Dictionary<int, FoundationNativeCompletionMessage> completionMessages = new Dictionary<int, FoundationNativeCompletionMessage>();
    private IntPtr processHandle;
    private IntPtr jobHandle;
    private IntPtr completionPort;
    private SafeFileHandle stdoutReadHandle;
    private SafeFileHandle stderrReadHandle;
    private Thread completionThread;
    private volatile bool stopCompletionThread;
    private bool activeZeroObserved;
    private bool disposed;
    private string completionError;

    public int Id { get; private set; }
    public long StartTimeFileTimeUtc { get; private set; }
    public string ExecutablePath { get; private set; }
    public TextReader StandardOutput { get; private set; }
    public TextReader StandardError { get; private set; }

    private FoundationValidationNativeProcessSession() { }

    private static void ThrowLastError(string operation)
    {
        throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }

    private static long ToFileTime(FILETIME_NATIVE value)
    {
        return ((long)value.dwHighDateTime << 32) | value.dwLowDateTime;
    }

    private static long GetStartTime(IntPtr process)
    {
        FILETIME_NATIVE creation;
        FILETIME_NATIVE exit;
        FILETIME_NATIVE kernel;
        FILETIME_NATIVE user;
        if (!GetProcessTimes(process, out creation, out exit, out kernel, out user)) { ThrowLastError("GetProcessTimes"); }
        return ToFileTime(creation);
    }

    private static string GetExecutablePath(IntPtr process)
    {
        StringBuilder path = new StringBuilder(32768);
        uint size = (uint)path.Capacity;
        if (!QueryFullProcessImageNameW(process, 0, path, ref size)) { ThrowLastError("QueryFullProcessImageNameW"); }
        return path.ToString();
    }

    private static string BuildEnvironmentBlock(string[] entries)
    {
        if (entries == null) { throw new ArgumentNullException("entries"); }
        StringBuilder block = new StringBuilder();
        for (int index = 0; index < entries.Length; index++)
        {
            string entry = entries[index];
            if (String.IsNullOrEmpty(entry) || entry.IndexOf('\0') >= 0 || entry.IndexOf('=') <= 0) { throw new ArgumentException("invalid environment entry"); }
            block.Append(entry);
            block.Append('\0');
        }
        block.Append('\0');
        return block.ToString();
    }

    private static void SetJobInformation<T>(IntPtr job, int informationClass, T value) where T : struct
    {
        int size = Marshal.SizeOf(typeof(T));
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(value, buffer, false);
            if (!SetInformationJobObject(job, informationClass, buffer, (uint)size)) { ThrowLastError("SetInformationJobObject"); }
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private static void ProbeFault(Func<string, int, long, string, bool> faultProbe, string phase, int processId, long startTimeFileTimeUtc, string executablePath)
    {
        if (faultProbe != null && faultProbe(phase, processId, startTimeFileTimeUtc, executablePath))
        {
            throw new InvalidOperationException("PROCESS_FAULT_INJECTED:" + phase);
        }
    }

    public static FoundationValidationNativeProcessSession Create(string applicationPath, string commandLine, string currentDirectory, string[] environmentEntries)
    {
        return Create(applicationPath, commandLine, currentDirectory, environmentEntries, null);
    }

    public static FoundationValidationNativeProcessSession Create(string applicationPath, string commandLine, string currentDirectory, string[] environmentEntries, Func<string, int, long, string, bool> faultProbe)
    {
        if (String.IsNullOrWhiteSpace(applicationPath) || String.IsNullOrWhiteSpace(commandLine) || String.IsNullOrWhiteSpace(currentDirectory)) { throw new ArgumentException("process input missing"); }
        FoundationValidationNativeProcessSession session = new FoundationValidationNativeProcessSession();
        IntPtr stdoutWrite = IntPtr.Zero;
        IntPtr stderrWrite = IntPtr.Zero;
        IntPtr stdinRead = IntPtr.Zero;
        IntPtr stdinWrite = IntPtr.Zero;
        IntPtr environment = IntPtr.Zero;
        IntPtr threadHandle = IntPtr.Zero;
        PROCESS_INFORMATION processInformation = new PROCESS_INFORMATION();
        bool processCreated = false;
        try
        {
            session.jobHandle = CreateJobObjectW(IntPtr.Zero, null);
            if (session.jobHandle == IntPtr.Zero) { ThrowLastError("CreateJobObjectW"); }
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetJobInformation(session.jobHandle, JobObjectExtendedLimitInformation, limits);
            ProbeFault(faultProbe, "job_setup", 0, 0, null);
            session.completionPort = CreateIoCompletionPort(new IntPtr(-1), IntPtr.Zero, UIntPtr.Zero, 1);
            if (session.completionPort == IntPtr.Zero) { ThrowLastError("CreateIoCompletionPort"); }
            JOBOBJECT_ASSOCIATE_COMPLETION_PORT association = new JOBOBJECT_ASSOCIATE_COMPLETION_PORT();
            association.CompletionKey = session.jobHandle;
            association.CompletionPort = session.completionPort;
            SetJobInformation(session.jobHandle, JobObjectAssociateCompletionPortInformation, association);
            ProbeFault(faultProbe, "job_completion_port", 0, 0, null);

            SECURITY_ATTRIBUTES pipeAttributes = new SECURITY_ATTRIBUTES();
            pipeAttributes.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
            pipeAttributes.bInheritHandle = true;
            IntPtr stdoutRead;
            if (!CreatePipe(out stdoutRead, out stdoutWrite, ref pipeAttributes, 0)) { ThrowLastError("CreatePipe:stdout"); }
            session.stdoutReadHandle = new SafeFileHandle(stdoutRead, true);
            if (!SetHandleInformation(stdoutRead, HANDLE_FLAG_INHERIT, 0)) { ThrowLastError("SetHandleInformation:stdout"); }
            IntPtr stderrRead;
            if (!CreatePipe(out stderrRead, out stderrWrite, ref pipeAttributes, 0)) { ThrowLastError("CreatePipe:stderr"); }
            session.stderrReadHandle = new SafeFileHandle(stderrRead, true);
            if (!SetHandleInformation(stderrRead, HANDLE_FLAG_INHERIT, 0)) { ThrowLastError("SetHandleInformation:stderr"); }
            if (!CreatePipe(out stdinRead, out stdinWrite, ref pipeAttributes, 0)) { ThrowLastError("CreatePipe:stdin"); }
            if (!SetHandleInformation(stdinWrite, HANDLE_FLAG_INHERIT, 0)) { ThrowLastError("SetHandleInformation:stdin"); }

            STARTUPINFO startup = new STARTUPINFO();
            startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            startup.dwFlags = STARTF_USESTDHANDLES;
            startup.hStdInput = stdinRead;
            startup.hStdOutput = stdoutWrite;
            startup.hStdError = stderrWrite;
            environment = Marshal.StringToHGlobalUni(BuildEnvironmentBlock(environmentEntries));
            StringBuilder mutableCommandLine = new StringBuilder(commandLine);
            uint flags = CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT;
            if (!CreateProcessW(applicationPath, mutableCommandLine, IntPtr.Zero, IntPtr.Zero, true, flags, environment, currentDirectory, ref startup, out processInformation)) { ThrowLastError("CreateProcessW"); }
            processCreated = true;
            session.processHandle = processInformation.hProcess;
            threadHandle = processInformation.hThread;
            session.Id = checked((int)processInformation.dwProcessId);
            session.StartTimeFileTimeUtc = GetStartTime(session.processHandle);
            session.ExecutablePath = GetExecutablePath(session.processHandle);
            ProbeFault(faultProbe, "pid_identity", session.Id, session.StartTimeFileTimeUtc, session.ExecutablePath);
            if (!AssignProcessToJobObject(session.jobHandle, session.processHandle)) { ThrowLastError("AssignProcessToJobObject"); }
            ProbeFault(faultProbe, "job_assign", session.Id, session.StartTimeFileTimeUtc, session.ExecutablePath);
            if (ResumeThread(threadHandle) == UInt32.MaxValue) { ThrowLastError("ResumeThread"); }
            CloseHandle(threadHandle);
            threadHandle = IntPtr.Zero;
            CloseHandle(stdoutWrite);
            stdoutWrite = IntPtr.Zero;
            CloseHandle(stderrWrite);
            stderrWrite = IntPtr.Zero;
            CloseHandle(stdinRead);
            stdinRead = IntPtr.Zero;
            CloseHandle(stdinWrite);
            stdinWrite = IntPtr.Zero;
            session.StandardOutput = new StreamReader(new FileStream(session.stdoutReadHandle, FileAccess.Read, 4096, false), new UTF8Encoding(false, false), true, 4096);
            session.StandardError = new StreamReader(new FileStream(session.stderrReadHandle, FileAccess.Read, 4096, false), new UTF8Encoding(false, false), true, 4096);
            session.StartCompletionPump();
            return session;
        }
        catch
        {
            if (processCreated && processInformation.hProcess != IntPtr.Zero) { TerminateProcess(processInformation.hProcess, 1); }
            session.Dispose();
            throw;
        }
        finally
        {
            if (environment != IntPtr.Zero) { Marshal.FreeHGlobal(environment); }
            if (threadHandle != IntPtr.Zero) { CloseHandle(threadHandle); }
            if (stdoutWrite != IntPtr.Zero) { CloseHandle(stdoutWrite); }
            if (stderrWrite != IntPtr.Zero) { CloseHandle(stderrWrite); }
            if (stdinRead != IntPtr.Zero) { CloseHandle(stdinRead); }
            if (stdinWrite != IntPtr.Zero) { CloseHandle(stdinWrite); }
        }
    }

    private void StartCompletionPump()
    {
        completionThread = new Thread(CompletionPump);
        completionThread.IsBackground = true;
        completionThread.Name = "FoundationValidationJobCompletion";
        completionThread.Start();
    }

    private void CompletionPump()
    {
        try
        {
            while (!stopCompletionThread)
            {
                uint message;
                UIntPtr key;
                IntPtr overlapped;
                bool ok = GetQueuedCompletionStatus(completionPort, out message, out key, out overlapped, 50);
                if (!ok)
                {
                    int error = Marshal.GetLastWin32Error();
                    if (error == (int)WAIT_TIMEOUT) { continue; }
                    if (!stopCompletionThread) { lock (sync) { completionError = new Win32Exception(error, "GetQueuedCompletionStatus").ToString(); } }
                    break;
                }
                if (stopCompletionThread && message == 0 && overlapped == IntPtr.Zero) { break; }
                int processId = unchecked((int)overlapped.ToInt64());
                if (message == JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO)
                {
                    lock (sync) { activeZeroObserved = true; }
                    continue;
                }
                if (processId <= 0) { continue; }
                if (message == JOB_OBJECT_MSG_NEW_PROCESS) { RecordProcessEvent(processId, "new_process", false); }
                else if (message == JOB_OBJECT_MSG_EXIT_PROCESS) { RecordProcessEvent(processId, "exit_process", true); }
                else if (message == JOB_OBJECT_MSG_ABNORMAL_EXIT_PROCESS) { RecordProcessEvent(processId, "abnormal_exit_process", true); }
            }
        }
        catch (Exception error)
        {
            lock (sync) { completionError = error.ToString(); }
        }
    }

    private void RecordProcessEvent(int processId, string eventName, bool exitObserved)
    {
        FoundationNativeCompletionMessage row;
        lock (sync)
        {
            if (!completionMessages.TryGetValue(processId, out row))
            {
                row = new FoundationNativeCompletionMessage();
                row.ProcessId = processId;
                row.FirstEvent = eventName;
                row.LastEvent = eventName;
                completionMessages.Add(processId, row);
            }
            else { row.LastEvent = eventName; }
            if (exitObserved) { row.ExitObserved = true; }
        }
        if (eventName != "new_process") { return; }
        IntPtr opened = IntPtr.Zero;
        try
        {
            if (processId == Id) { opened = processHandle; }
            else
            {
                opened = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, false, unchecked((uint)processId));
                if (opened == IntPtr.Zero) { ThrowLastError("OpenProcess"); }
            }
            long start = processId == Id ? StartTimeFileTimeUtc : GetStartTime(opened);
            string path = processId == Id ? ExecutablePath : GetExecutablePath(opened);
            long length = 0;
            string sha256 = null;
            using (SafeFileHandle file = FoundationValidationNativePath.OpenImmutableRead(path))
            {
                FoundationNativePathInfo info = FoundationValidationNativePath.GetInfo(file);
                length = info.Length;
                sha256 = FoundationValidationNativePath.Sha256(file);
            }
            lock (sync)
            {
                row.StartTimeFileTimeUtc = start;
                row.ExecutablePath = path;
                row.Length = length;
                row.Sha256 = sha256;
            }
        }
        catch (Exception error)
        {
            lock (sync) { row.IdentityError = error.ToString(); }
        }
        finally
        {
            if (opened != IntPtr.Zero && opened != processHandle) { CloseHandle(opened); }
        }
    }

    private FoundationNativeJobAccounting QueryAccounting()
    {
        int size = Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            uint returned;
            if (!QueryInformationJobObject(jobHandle, JobObjectBasicAccountingInformation, buffer, (uint)size, out returned)) { ThrowLastError("QueryInformationJobObject"); }
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION value = (JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)Marshal.PtrToStructure(buffer, typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
            FoundationNativeJobAccounting result = new FoundationNativeJobAccounting();
            result.TotalProcesses = value.TotalProcesses;
            result.ActiveProcesses = value.ActiveProcesses;
            result.TotalTerminatedProcesses = value.TotalTerminatedProcesses;
            return result;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    public bool WaitForExit(int timeoutMilliseconds)
    {
        if (timeoutMilliseconds < 0) { throw new ArgumentOutOfRangeException("timeoutMilliseconds"); }
        return WaitForSingleObject(processHandle, unchecked((uint)timeoutMilliseconds)) == WAIT_OBJECT_0;
    }

    public bool HasExited
    {
        get { return WaitForSingleObject(processHandle, 0) == WAIT_OBJECT_0; }
    }

    public int ExitCode
    {
        get
        {
            uint code;
            if (!GetExitCodeProcess(processHandle, out code)) { ThrowLastError("GetExitCodeProcess"); }
            if (code == STILL_ACTIVE) { throw new InvalidOperationException("process is still active"); }
            return unchecked((int)code);
        }
    }

    public bool WaitForJobEmpty(int timeoutMilliseconds)
    {
        DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeoutMilliseconds);
        while (true)
        {
            FoundationNativeJobAccounting accounting = QueryAccounting();
            if (accounting.ActiveProcesses == 0)
            {
                lock (sync) { activeZeroObserved = true; }
                return true;
            }
            if (DateTime.UtcNow >= deadline) { return false; }
            Thread.Sleep(20);
        }
    }

    public bool TerminateJob(int exitCode)
    {
        if (!TerminateJobObject(jobHandle, unchecked((uint)exitCode))) { return false; }
        return WaitForJobEmpty(5000);
    }

    public FoundationNativeJobSnapshot GetJobSnapshot()
    {
        FoundationNativeJobSnapshot snapshot = new FoundationNativeJobSnapshot();
        snapshot.Accounting = QueryAccounting();
        lock (sync)
        {
            FoundationNativeCompletionMessage[] rows = new FoundationNativeCompletionMessage[completionMessages.Count];
            int index = 0;
            foreach (KeyValuePair<int, FoundationNativeCompletionMessage> pair in completionMessages)
            {
                FoundationNativeCompletionMessage source = pair.Value;
                FoundationNativeCompletionMessage clone = new FoundationNativeCompletionMessage();
                clone.ProcessId = source.ProcessId;
                clone.StartTimeFileTimeUtc = source.StartTimeFileTimeUtc;
                clone.ExecutablePath = source.ExecutablePath;
                clone.Length = source.Length;
                clone.Sha256 = source.Sha256;
                clone.FirstEvent = source.FirstEvent;
                clone.LastEvent = source.LastEvent;
                clone.ExitObserved = source.ExitObserved;
                clone.IdentityError = source.IdentityError;
                rows[index++] = clone;
            }
            Array.Sort(rows, delegate(FoundationNativeCompletionMessage left, FoundationNativeCompletionMessage right) { return left.ProcessId.CompareTo(right.ProcessId); });
            snapshot.Messages = rows;
            snapshot.ActiveZeroObserved = activeZeroObserved || snapshot.Accounting.ActiveProcesses == 0;
            snapshot.CompletionError = completionError;
        }
        return snapshot;
    }

    public void Dispose()
    {
        if (disposed) { return; }
        disposed = true;
        try
        {
            if (jobHandle != IntPtr.Zero)
            {
                try
                {
                    FoundationNativeJobAccounting accounting = QueryAccounting();
                    if (accounting.ActiveProcesses != 0) { TerminateJobObject(jobHandle, 1); }
                }
                catch { }
            }
            stopCompletionThread = true;
            if (completionPort != IntPtr.Zero) { PostQueuedCompletionStatus(completionPort, 0, UIntPtr.Zero, IntPtr.Zero); }
            if (completionThread != null && completionThread.IsAlive) { completionThread.Join(2000); }
        }
        finally
        {
            if (StandardOutput != null) { StandardOutput.Dispose(); StandardOutput = null; }
            if (StandardError != null) { StandardError.Dispose(); StandardError = null; }
            if (stdoutReadHandle != null && !stdoutReadHandle.IsClosed) { stdoutReadHandle.Dispose(); }
            if (stderrReadHandle != null && !stderrReadHandle.IsClosed) { stderrReadHandle.Dispose(); }
            if (processHandle != IntPtr.Zero) { CloseHandle(processHandle); processHandle = IntPtr.Zero; }
            if (jobHandle != IntPtr.Zero) { CloseHandle(jobHandle); jobHandle = IntPtr.Zero; }
            if (completionPort != IntPtr.Zero) { CloseHandle(completionPort); completionPort = IntPtr.Zero; }
        }
    }
}
'@
}

$script:FoundationEmbeddedNativeAssemblyLength = 35840
$script:FoundationEmbeddedNativeAssemblySha256 = "712D1464A9F71455EAC646BF2218BDB8FB678359108BA30A480C8994DBBC762F"
$script:FoundationEmbeddedNativeAssemblyFullName = "FoundationValidation.Embedded, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null"
$script:FoundationEmbeddedNativeAssemblyMvid = "EA0E95E5-5D7F-4BDF-AFC2-7E2E29FC3369"
$script:FoundationEmbeddedNativeSourceSha256 = "9D8F7C4E70F2F6529A74F4120630C7500488DFCFAB71501CE772208FCB524C0C"
$script:FoundationEmbeddedNativeContractSha256 = "0781DAF54F83326A10F8B6EB8258D8D7AED1F9B1154695C1905E80F2F660A2B6"
$script:FoundationEmbeddedNativeAssemblyValidated = $false
$script:FoundationEmbeddedNativeAssemblyObject = $null
$script:FoundationEmbeddedNativeAssemblyBase64 = @'
TVqQAAMAAAAEAAAA//8AALgAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAA4fug4AtAnNIbgBTM0hVGhpcyBwcm9ncmFt
IGNhbm5vdCBiZSBydW4gaW4gRE9TIG1vZGUuDQ0KJAAAAAAAAABQRQAATAEDAJBOemoAAAAAAAAAAOAAAiELAQsAAIQAAAAGAAAAAAAAnqIAAAAgAAAAwAAA
AAAAEAAgAAAAAgAABAAAAAAAAAAEAAAAAAAAAAAAAQAAAgAAAAAAAAMAQIUAABAAABAAAAAAEAAAEAAAAAAAABAAAAAAAAAAAAAAAEyiAABPAAAAAMAAAPgC
AAAAAAAAAAAAAAAAAAAAAAAAAOAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAACAAAAAAAAAAAAAAA
CCAAAEgAAAAAAAAAAAAAAC50ZXh0AAAApIIAAAAgAAAAhAAAAAIAAAAAAAAAAAAAAAAAACAAAGAucnNyYwAAAPgCAAAAwAAAAAQAAACGAAAAAAAAAAAAAAAA
AABAAABALnJlbG9jAAAMAAAAAOAAAAACAAAAigAAAAAAAAAAAAAAAAAAQAAAQgAAAAAAAAAAAAAAAAAAAACAogAAAAAAAEgAAAACAAUAOEMAABRfAAABAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4CewEAAAQqIgIDfQEAAAQqHgJ7AgAABCoiAgN9AgAABCoeAnsD
AAAEKiICA30DAAAEKh4CewQAAAQqIgIDfQQAAAQqHgJ7BQAABCoiAgN9BQAABCoeAnsGAAAEKiICA30GAAAEKh4CKAYAAAoqHgJ7BwAABCoiAgN9BwAABCoe
AnsIAAAEKiICA30IAAAEKh4CKAYAAAoqHgJ7CQAABCoiAgN9CQAABCoeAnsKAAAEKiICA30KAAAEKh4CKAYAAAoqMigIAAAKAnMJAAAKKvoCKAoAAAotHwJv
CwAAChkyFgIXbwwAAAofOjMLAhhvDAAACh9cLgtyAQAAcHMNAAAKenI1AABwAigOAAAKKgAAEzAHAEgAAAABAAARFwMtAxYrARhgCgIoJgAABiCAAAAABn4P
AAAKGSAAACACfg8AAAooGAAABgsHbxAAAAosDwQoCAAAClQHbxEAAAoUKgQWVAcqEzAHAEMAAAACAAARAigmAAAGIIAAAIAXfg8AAAoZIAAAIAJ+DwAACigY
AAAGCgZvEAAACiwXBm8RAAAKcj8AAHACKA4AAAooJQAABnoGKgATMAcAQwAAAAIAABECKCYAAAYggAABwBd+DwAAChcgAAAggH4PAAAKKBgAAAYKBm8QAAAK
LBcGbxEAAApyhwAAcAIoDgAACiglAAAGegYqABMwBwBDAAAAAgAAEQIoJgAABiCgAAAAGX4PAAAKGSAAACACfg8AAAooGAAABgoGbxAAAAosFwZvEQAACnLF
AABwAigOAAAKKCUAAAZ6BioAEzAHAEMAAAACAAARAigmAAAGIIAAAMAXfg8AAAoZIAAAIIJ+DwAACigYAAAGCgZvEAAACiwXBm8RAAAKcgsBAHACKA4AAAoo
JQAABnoGKgATMAcAQwAAAAIAABECKCYAAAYggAABgBl+DwAAChkgAAAggn4PAAAKKBgAAAYKBm8QAAAKLBcGbxEAAApyawEAcAIoDgAACiglAAAGegYqABMw
BwA+AAAAAgAAEQIoJgAABiCAAAGAGX4PAAAKGSAAACCCfg8AAAooGAAABgoGbxAAAAosDwMoCAAAClQGbxEAAAoUKgMWVAYqAAATMAcAPgAAAAIAABECKCYA
AAYggAAAgBd+DwAAChkgAAAgAn4PAAAKKBgAAAYKBm8QAAAKLA8DKAgAAApUBm8RAAAKFCoDFlQGKgAAEzAEAHMBAAADAAARcxIAAAoKIAAAAQCNGwAAAQsD
LQQfCisCHwsMAggHB45pKB0AAAYtNigIAAAKDQkfEjMfcxcAAAYTBBEEFo0DAAACbxQAAAYRBBdvFgAABhEEKglytwEAcHMJAAAKehYTBREFFjIKEQUfaFgH
jmkxC3IvAgBwcw0AAAp6BxEFKBMAAAoTBgcRBR84WCgTAAAKEwcHEQUfPFgoEwAAChMIEQgXXy0ZEQggAIAAADUQEQUfaFhqEQhuWAeOaWoxC3KTAgBwcw0A
AAp6KBQAAAoHEQUfaFgRCG8VAAAKEwkRCXLzAgBwKBYAAAosLxEJcvcCAHAoFgAACiwhBnMSAAAGEwoRChEJbw8AAAYRChEHbxEAAAYRCm8XAAAKEQYsNhEG
H2g3GREFahEGblgRBWoxDREFahEGblgHjmlqMgty/QIAcHMNAAAKehEFEQZYEwU4Df///3MXAAAGEwsRCwZvGAAACm8UAAAGEQsWbxYAAAYRCyoAEzAEADgA
AAAEAAAREgH+FQgAAAISARd9MwAABAcKAhoSANAIAAACKBkAAAooGgAACigbAAAGLQtyYQMAcCglAAAGeipcAC8AOgAAADwAPgAiAHwAPwAqABswBABFAgAA
BQAAEQIsfAJvEAAACi10Am8bAAAKLWwDLGkDbxAAAAotYQNvGwAACi1ZBCgKAAAKLVEEcvMCAHAoHAAACi1EBHL3AgBwKBwAAAotNwRyzQMAcBpvHQAACi0p
BHLzAgBwGm8dAAAKLRsEHwqNIQAAASXQqgAABCgeAAAKbx8AAAoWMgty0QMAcHMNAAAKegQTDhYTDysgEQ4RD28MAAAKCgYfIC8LctEDAHBzDQAACnoRDxdY
Ew8RDxEObwsAAAoy1QMoNQAABgsHbwsAAAYMB28FAAAGHxBfLFEHbwUAAAYgAAQAAF8tQwgoIAAACi07CG8LAAAKHTIyCHI1AABwGm8hAAAKLCQIGm8MAAAK
KCIAAAosFggbbwwAAAofOjMLCBxvDAAACh9cLgtyCwQAcHMNAAAKeggabyMAAAoXjSEAAAETEBEQFh9cnREQbyQAAApyVwQAcAQoJQAACg0oFAAACglvJgAA
ChMEKCcAAAoeLgMaKwEeEwURBSgnAAAKWBMGEQYaWBMHEQcY1hEEjmnWEwgRCCgoAAAKEwkWEwoWEwsrEBEJEQsWKCkAAAoRCxdYEwsRCxEIMuoRCRYWKCoA
AAoDEgpvKwAAChEJEQV+DwAACigsAAAKEQkRBhEEjmkoKgAAChEEFhEJEQcoLQAAChEEjmkoLgAACgIZEQkRCCgcAAAGEwwRDC0HKAgAAAorARYTDREMLRkR
DXJbBABwEg0oLwAACigOAAAKcwkAAAp63hIRCiwGA28wAAAKEQkoMQAACtwqAAAAARAAAAIAnAGWMgISAAAAABMwCABvAQAABgAAESAAQAAAjRsAAAEKAiCo
AAkAFBYGBo5pEgF+DwAACighAAAGLQtywQQAcCglAAAGegcfEDcOBhYoEwAACiADAACgLgty/wQAcHMNAAAKegYeKDIAAAoMBh8KKDIAAAoNBh8MKDIAAAoT
BAYfDigyAAAKEwUfEAhYEwYfEBEEWBMHCC1ZCRYxVQkXXy1QEQQJGFgzSREFF18tQxEGHxAyPREGCVgYWGoHbjAyEQcRBVgYWGoHbjAmBhEGCViRLR4GEQYJ
WBdYkS0UBhEHEQVYkS0LBhEHEQVYF1iRLAtyYwUAcHMNAAAKeigUAAAKBhEGCW8VAAAKEwgoFAAACgYRBxEFbxUAAAoTCREIcssFAHAabyEAAAosChEIbwsA
AAodLwty1QUAcHMNAAAKehEIGm8jAAAKEwoRCBZvMwAAChYvIBEJFm8zAAAKFi8VEQlvCwAACiwXEQkRChtvNAAACi0LckEGAHBzDQAACnoRCioAEzAIAFMB
AAAHAAARAygKAAAKLR8DbwsAAAoZMhYDF28MAAAKHzozCwMYbwwAAAofXC4LcqkGAHBzDQAACnpyywUAcAMoDgAACgoDCygUAAAKBm8mAAAKDCgUAAAKB28m
AAAKDQiOaRhYCY5pWBhYEwQfEBEEWI0bAAABEwUgAwAAoCg1AAAKFhEFFhooNgAACh4RBFjRKDcAAAoWEQUaGCg2AAAKFig3AAAKFhEFHhgoNgAACgiOadEo
NwAAChYRBR8KGCg2AAAKCI5pGFjRKDcAAAoWEQUfDBgoNgAACgmOadEoNwAAChYRBR8OGCg2AAAKCBYRBR8QCI5pKDYAAAoJFhEFHxAIjmlYGFgJjmkoNgAA
CgIgpAAJABEFEQWOaRQWEgZ+DwAACighAAAGLQtyHwcAcCglAAAGegIoNQAABhMHEQdvBQAABiAABAAAXy0Lcl0HAHBzDQAACnoqkgIoJgAABn4PAAAKKBkA
AAYtEXK3BwBwAigOAAAKKCUAAAZ6KhMwBAD+AAAACAAAEQISACgaAAAGLQty6wcAcCglAAAGeiAAgAAAczgAAAoLAgcHbzkAAAoWKB4AAAYMCCwLCG4HbzkA
AApqMgtyLwgAcCglAAAGehIAey4AAARuHyBiEgB7LwAABG5gDRIAfCwAAAR7KAAABG4fIGISAHwsAAAEeycAAARuYBMEcw0AAAYTBREFEgB8LQAABHJxCABw
KDoAAApvAgAABhEFEgB8MQAABHJxCABwKDoAAAoSAHwyAAAEcnEIAHAoOgAACigOAAAKbwQAAAYRBRIAeykAAARvBgAABhEFCW8IAAAGEQURBCg7AAAKbwoA
AAYRBQdvPAAACm8MAAAGEQUqAAATMAUAeQAAAAkAABEWCitZIAAAEABqA45pagZuWSg9AAAKbQsGLQwHbgOOaWozBAMMKxIH4I0bAAABDAMGCBYHKDYAAAoC
CAcSA34PAAAKKB8AAAYsBAkHLgtydwgAcCglAAAGegYJWAoGbgOOaWoynwIoIAAABi0LcpkIAHAoJQAABnoqAAAAGzAHAL0AAAAKAAARAig1AAAGCgZvBwAA
BhZqMg4GbwcAAAYg////f2oxC3LJCABwcw0AAAp6AhZqEgEWKCIAAAYtC3INCQBwKCUAAAZ6KCQAAAYNCQIJEgIWFhgoIwAABi0Lcj0JAHAoJQAABnoIEwcI
FyAAAAEAFnM+AAAKEwQGbwcAAAZpcz8AAAoTBREEEQVvQAAAChEFb0EAAAoTBt4kEQUsBxEFb0IAAArcEQQsBxEEb0IAAArcEQcsBxEHb0IAAArcEQYqAAAA
ASgAAAIAggAUlgAMAAAAAAIAdAAuogAMAAAAAAIAZQBJrgAMAAAAABMwBwAiAAAACwAAESgkAAAGCwcCBxIAFhYYKCMAAAYtC3I9CQBwKCUAAAZ6BioAABsw
BwCVAAAADAAAEQIWahIAFigiAAAGLQtyDQkAcCglAAAGeigkAAAGDAgCCBIBFhYYKCMAAAYtC3I9CQBwKCUAAAZ6BxMGBxcgAAABABZzPgAACg0oQwAAChME
EQQJb0QAAAooRQAACnJrCQBwcm8JAHBvRgAAChMF3iIRBCwHEQRvQgAACtwJLAYJb0IAAArcEQYsBxEGb0IAAArcEQUqAAAAASgAAAIAUAAgcAAMAAAAAAIA
SQAzfAAKAAAAAAIAOwBLhgAMAAAAAB4CezYAAAQqIgIDfTYAAAQqHgJ7NwAABCoiAgN9NwAABCqqAnMGAAAKfTQAAAQCc0gAAAp9NQAABAIoBgAACgICAyg/
AAAGKDsAAAYqAAAAGzAEAGgBAAANAAARFwsCe6sAAAQNCRYmJgJ7qwAABBMEEQQWLmgCIAAQAACNIQAAAX2vAAAEAnuuAAAEAnuvAAAEFgJ7rwAABI5pb0wA
AAoWb00AAAoTBRIFKE4AAAoTBhIGKE8AAAotQwIWfasAAAQCEQZ9sgAABAJ8rAAABBIGAigBAAArFgvd5QAAAAJ7sgAABBMGAhIH/hUEAAAbEQd9sgAABAIV
fasAAAQSBihRAAAKEgb+FQQAABsTCAIRCH2wAAAEAnuwAAAEFjFiAhZ9sQAABAICe60AAAR7NAAABCUTCX20AAAEEQkCfLEAAAQoUgAACgJ7rQAABHs1AAAE
AnuvAAAEFgJ7sAAABG9TAAAKJt0c////BywTAnuxAAAELAsCe7QAAAQoVAAACtzeFAoCe60AAAQGbzwAAApvPQAABv4a3hcMAh/+fasAAAQCfKwAAAQIKFUA
AAreEwIf/n2rAAAEAnysAAAEKFYAAAoqQUwAAAIAAADKAAAARAAAAA4BAAAXAAAAAAAAAAAAAAANAAAAGgEAACcBAAAUAAAAOAAAAQAAAAAAAAAAPQEAAD0B
AAAXAAAAOAAAATYCfKwAAAQDKFgAAAoqAAATMAIAQgAAAA4AABESAAJ9rQAABBIAA32uAAAEEgAoWgAACn2sAAAEEgAVfasAAAQSAHusAAAECxIBEgAoAgAA
KxIAfKwAAAQoXAAACioAABswAgArAAAADwAAERYKAns0AAAEJQwSAChSAAAKAns1AAAEbzwAAAoL3goGLAYIKFQAAArcByoAARAAAAIAAgAdHwAKAAAAABsw
AwAqAAAAEAAAERiNCAAAAQsHFgJvOgAABqIHFwNvOgAABqIHBChdAAAKCt4FJhcK3gAGKgAAARAAAAAAAAAjIwAFOwAAAR4CezgAAAQqIgIDfTgAAAQqHgJ7
OQAABCoiAgN9OQAABCoeAns6AAAEKiICA306AAAEKh4CezsAAAQqIgIDfTsAAAQqHgJ7PAAABCoiAgN9PAAABCoeAns9AAAEKiICA309AAAEKh4Cez4AAAQq
IgIDfT4AAAQqHgJ7PwAABCoiAgN9PwAABCoeAntAAAAEKiICA31AAAAEKh4CKAYAAAoqHgJ7QQAABCoiAgN9QQAABCoeAntCAAAEKiICA31CAAAEKh4Ce0MA
AAQqIgIDfUMAAAQqHgIoBgAACioeAntEAAAEKiICA31EAAAEKh4Ce0UAAAQqIgIDfUUAAAQqHgJ7RgAABCoiAgN9RgAABCoeAntHAAAEKiICA31HAAAEKh4C
KAYAAAoqHgJ7agAABCoiAgN9agAABCoeAntrAAAEKiICA31rAAAEKh4Ce2wAAAQqIgIDfWwAAAQqHgJ7bQAABCoiAgN9bQAABCoeAntuAAAEKiICA31uAAAE
KnYCcwYAAAp9XgAABAJzXgAACn1fAAAEAigGAAAKKjIoCAAACgJzCQAACnpWDwB7igAABG4fIGIPAHuJAAAEbmAqAAATMAUAIQAAABEAABECEgASARICEgMo
dQAABi0KcnEJAHAohAAABgYohQAABioAAAATMAQALwAAABIAABEgAIAAAHM4AAAKCgZvOQAACgsCFgYSASh2AAAGLQpykQkAcCiEAAAGBm88AAAKKgATMAIA
bQAAABMAABECLQtyxwkAcHNfAAAKenNIAAAKChYLK0ACB5oMCCggAAAKLRUIFm8zAAAKFi8LCB89bzMAAAoWMAty1wkAcHNgAAAKegYIb2EAAAomBhZvYgAA
CiYHF1gLBwKOaTK6BhZvYgAACiYGbzwAAAoqAAAAGzAEAD4AAAAUAAAR0AYAABsoGQAACigaAAAKCgYoKAAACgsEBxYoAwAAKwIDBwYoagAABi0KcgsKAHAo
hAAABt4HBygxAAAK3CoAAAEQAAACABcAHzYABwAAAACKAiweAgMEBQ4Eb2QAAAosEXI7CgBwAygOAAAKcw0AAAp6Ki4CAwQFFCiMAAAGKgAbMAoAkwQAABUA
ABECKAoAAAotEAMoCgAACi0IBCgKAAAKLAtyawoAcHNgAAAKenODAAAGCn4PAAAKC34PAAAKDH4PAAAKDX4PAAAKEwR+DwAAChMFfg8AAAoTBhIH/hUQAAAC
FhMIBn4PAAAKFChpAAAGfWEAAAQGe2EAAAR+DwAACihlAAAKLApylwoAcCiEAAAGEgn+FRQAAAISCXyaAAAEIAAgAAB9kwAABAZ7YQAABB8JEQkoBAAAKw4E
crkKAHAWFmoUKIoAAAYGFXNmAAAKfg8AAAp+ZwAAChcobgAABn1iAAAEBntiAAAEfg8AAAooZQAACiwKcs0KAHAohAAABhIK/hUVAAACEgoGe2EAAAR9oAAA
BBIKBntiAAAEfaEAAAQGe2EAAAQdEQooBQAAKw4EcvsKAHAWFmoUKIoAAAYSC/4VDgAAAhIL0A4AAAIoGQAACigaAAAKfXAAAAQSCxd9cgAABBIMEgESCxYo
ZQAABi0KciMLAHAohAAABgYRDBdzaAAACn1jAAAEEQwXFihmAAAGLQpyRwsAcCiEAAAGEg0SAhILFihlAAAGLQpyfwsAcCiEAAAGBhENF3NoAAAKfWQAAAQR
DRcWKGYAAAYtCnKjCwBwKIQAAAYSAxIEEgsWKGUAAAYtCnLbCwBwKIQAAAYRBBcWKGYAAAYtCnL9CwBwKIQAAAYSDv4VDwAAAhIO0A8AAAIoGQAACigaAAAK
fXMAAAQSDiAAAQAAfX4AAAQSDgl9ggAABBIOB32DAAAEEg4IfYQAAAQFKIgAAAYoaQAAChMFA3NqAAAKEw8gBAQACBMQAhEPfg8AAAp+DwAAChcREBEFBBIO
EgcoaAAABi0KcjMMAHAohAAABhcTCAYSB3uFAAAEfWAAAAQSB3uGAAAEEwYGEgd7hwAABIRvegAABgYGe2AAAAQohgAABm98AAAGBgZ7YAAABCiHAAAGb34A
AAYOBHJRDABwBm95AAAGBm97AAAGBm99AAAGKIoAAAYGe2EAAAQGe2AAAAQobAAABi0KcmsMAHAohAAABg4Ecp0MAHAGb3kAAAYGb3sAAAYGb30AAAYoigAA
BhEGKHEAAAYVMwpyswwAcCiEAAAGEQYoeAAABiZ+DwAAChMGByh4AAAGJn4PAAAKCwgoeAAABiZ+DwAACgwJKHgAAAYmfg8AAAoNEQQoeAAABiZ+DwAAChME
BgZ7YwAABBcgABAAABZzPgAAChYWc2sAAAoXIAAQAABzbAAACm+AAAAGBgZ7ZAAABBcgABAAABZzPgAAChYWc2sAAAoXIAAQAABzbAAACm+CAAAGBm+NAAAG
BhMR3awAAAAmEQgsIRIHe4UAAAR+DwAACihtAAAKLA4SB3uFAAAEFyhyAAAGJgZvlwAABv4aEQV+DwAACihtAAAKLAcRBSgxAAAKEQZ+DwAACihtAAAKLAgR
Bih4AAAGJgd+DwAACihtAAAKLAcHKHgAAAYmCH4PAAAKKG0AAAosBwgoeAAABiYJfg8AAAoobQAACiwHCSh4AAAGJhEEfg8AAAoobQAACiwIEQQoeAAABibc
EREqAEE0AAAAAAAAWwAAAIkDAADkAwAALgAAAAEAAAECAAAAWwAAALcDAAASBAAAfgAAAAAAAAD+AgL+Bo4AAAZzbgAACnNvAAAKfWUAAAQCe2UAAAQXb3AA
AAoCe2UAAARyzQwAcG9xAAAKAntlAAAEb3IAAAoqGzAFAEsBAAAWAAAROAQBAAACe2IAAAQSABIBEgIfMihvAAAGDQktWygIAAAKEwQRBCACAQAAO9oAAAAC
/hN7ZgAABDraAAAAFhMFAnteAAAEJRMKEgUoUgAACgIRBHIRDQBwcwkAAApvPAAACn1pAAAE3asAAAARBSwHEQooVAAACtwC/hN7ZgAABCwTBi0QCH4PAAAK
KGUAAAo6ggAAABICKHMAAAppEwYGGjMoFhMHAnteAAAEJRMLEgcoUgAACgIXfWcAAATeSxEHLAcRCyhUAAAK3BEGFjE6BhwzEAIRBnJFDQBwFiiPAAAGKyYG
HTMQAhEGcl0NAHAXKI8AAAYrEgYeMw4CEQZydw0AcBcojwAABgL+E3tmAAAEOe/+///eMhMIFhMJAnteAAAEJRMMEgkoUgAACgIRCG88AAAKfWkAAATeDBEJ
LAcRDChUAAAK3N4AKgBBZAAAAgAAAD8AAAAsAAAAawAAAAwAAAAAAAAAAgAAAKUAAAAZAAAAvgAAAAwAAAAAAAAAAgAAAB0BAAAfAAAAPAEAAAwAAAAAAAAA
AAAAAAAAAAAYAQAAGAEAADIAAAA4AAABGzADALcBAAAXAAARFhMLAnteAAAEJRMMEgsoUgAACgJ7XwAABAMSAG90AAAKLSpzVAAABgoGA29DAAAGBgRvTQAA
BgYEb08AAAYCe18AAAQDBm91AAAKKwcGBG9PAAAGBSwHBhdvUQAABt4MEQssBxEMKFQAAArcBHJFDQBwKBYAAAosASp+DwAACgsDAih5AAAGMwkCe2AAAAQL
KyQgABAQABYDKHcAAAYLB34PAAAKKGUAAAosCnKjDQBwKIQAAAYDAih5AAAGLggHKIYAAAYrBgIoewAABgwDAih5AAAGLggHKIcAAAYrBgIofQAABg0WahME
FBMFCSgoAAAGEwYRBig1AAAGEwcRB28HAAAGEwQRBig5AAAGEwXeDBEGLAcRBm9CAAAK3BYTCAJ7XgAABCUTDRIIKFIAAAoGCG9FAAAGBglvRwAABgYRBG9J
AAAGBhEFb0sAAAbeDBEILAcRDShUAAAK3N4yEwkWEwoCe14AAAQlEw4SCihSAAAKBhEJbzwAAApvUwAABt4MEQosBxEOKFQAAArc3gDeIwd+DwAACihtAAAK
LBUHAntgAAAEKG0AAAosBwcoeAAABibcKgBBlAAAAgAAAAMAAABdAAAAYAAAAAwAAAAAAAAAAgAAAPUAAAAdAAAAEgEAAAwAAAAAAAAAAgAAACEBAAAwAAAA
UQEAAAwAAAAAAAAAAgAAAGQBAAAfAAAAgwEAAAwAAAAAAAAAAAAAAIAAAADfAAAAXwEAADIAAAA4AAABAgAAAIAAAAATAQAAkwEAACMAAAAAAAAAGzAFAIoA
AAAYAAAR0BYAAAIoGQAACigaAAAKCgYoKAAACgsCe2EAAAQXBwYSAihrAAAGLQpyuw0AcCiEAAAGB9AWAAACKBkAAAoodgAACqUWAAACDXNbAAAGEwQRBBID
e6cAAARvVgAABhEEEgN7qAAABG9YAAAGEQQSA3upAAAEb1oAAAYRBBMF3gcHKDEAAArcEQUqAAABEAAAAgAXAGmAAAcAAAAAfgMWLwty7w0AcHN3AAAKegJ7
YAAABAMocwAABhb+ASpCAntgAAAEFihzAAAGFv4BKgAAABMwAgAuAAAAGQAAEQJ7YAAABBIAKHQAAAYtCnIXDgBwKIQAAAYGIAMBAAAzC3I9DgBwcw0AAAp6
BioAABswAgBfAAAAGgAAESh4AAAKDRIDA2woeQAACgoCKJAAAAYLB29XAAAGLSgWDAJ7XgAABCUTBBICKFIAAAoCF31nAAAE3gsILAcRBChUAAAK3BcqKHgA
AAoGKHoAAAosAhYqHxQoewAACiuxAAEQAAACACEAGToACwAAAAByAnthAAAEAyhtAAAGLQIWKgIgiBMAACiUAAAGKgAAABMwAgAVAAAAGwAAEQJvQgAABgoS
AANvQgAABih8AAAKKgAAABswBABqAQAAHAAAEXNkAAAGCgYCKJAAAAZvXQAABhYTBgJ7XgAABCUTBxIGKFIAAAoCe18AAARvfQAACo0KAAACCxYMAntfAAAE
b34AAAoTCDifAAAAEggofwAACg0SAyiAAAAKEwRzVAAABhMFEQURBG9CAAAGb0MAAAYRBREEb0QAAAZvRQAABhEFEQRvRgAABm9HAAAGEQURBG9IAAAGb0kA
AAYRBREEb0oAAAZvSwAABhEFEQRvTAAABm9NAAAGEQURBG9OAAAGb08AAAYRBREEb1AAAAZvUQAABhEFEQRvUgAABm9TAAAGBwglF1gMEQWiEggogQAACjpV
////3g4SCP4WCAAAG29CAAAK3Ad+bwAABC0RFP4GmAAABnOCAAAKgG8AAAR+bwAABCgGAAArBgdvXwAABgYCe2cAAAQtEAZvXAAABm9XAAAGFv4BKwEXb2EA
AAYGAntpAAAEb2MAAAbeDBEGLAcRByhUAAAK3AYqAABBNAAAAgAAAEUAAACyAAAA9wAAAA4AAAAAAAAAAgAAABUAAABHAQAAXAEAAAwAAAAAAAAAGzAEAJEB
AAAdAAARAntoAAAELAEqAhd9aAAABAJ7YQAABH4PAAAKKG0AAAosIQIokAAABgoGb1cAAAYsDQJ7YQAABBcobQAABibeAybeAAIX/hN9ZgAABAJ7YgAABH4P
AAAKKG0AAAosFwJ7YgAABBZ+ZwAACn4PAAAKKHAAAAYmAntlAAAELB4Ce2UAAARvhAAACiwRAntlAAAEINAHAABvhQAACibd8AAAAAIofwAABiwSAih/AAAG
b4YAAAoCFCiAAAAGAiiBAAAGLBICKIEAAAZvhgAACgIUKIIAAAYCe2MAAAQsGAJ7YwAABG8bAAAKLQsCe2MAAARvEQAACgJ7ZAAABCwYAntkAAAEbxsAAAot
CwJ7ZAAABG8RAAAKAntgAAAEfg8AAAoobQAACiwXAntgAAAEKHgAAAYmAn4PAAAKfWAAAAQCe2EAAAR+DwAACihtAAAKLBcCe2EAAAQoeAAABiYCfg8AAAp9
YQAABAJ7YgAABH4PAAAKKG0AAAosFwJ7YgAABCh4AAAGJgJ+DwAACn1iAAAE3CoAAAABHAAAAAAiAB5AAAMBAAABAgAQAJCgAPAAAAAAQlNKQgEAAQAAAAAA
DAAAAHY0LjAuMzAzMTkAAAAABQBsAAAAUCEAACN+AAC8IQAAcCYAACNTdHJpbmdzAAAAACxIAABwDgAAI1VTAJxWAAAQAAAAI0dVSUQAAACsVgAAaAgAACNC
bG9iAAAAAAAAAAIAAAFXv6I/CR4AAAD6JTMAFgAAAQAAAEUAAAAZAAAAtAAAAJoAAADpAAAAAgAAAIYAAAAyAAAAbAAAAA0AAAABAAAAHQAAAAgAAAAjAAAA
RAAAAAIAAAABAAAACgAAACEAAAABAAAAAQAAAAIAAAAOAAAAAQAAAAYAAAABAAAAAAAKAAEAAAAAAAYAegJzAgYAgQJzAgYAiwJzAgYAAwNzAgYAMQcVBwYA
3QfRBwoAeQhjCAYAtwqgCgYAAAv2CgYAjBNxEwYABhT1EwYAPhQeFAYARRVzAgYAKhoLGgYAPRoLGgYAYRoLGgYAWB4eFAYAeB4eFAYAtB4eFAYAzx4LGgYA
7x4LGgYACR9zAgYALR9zAgYATh9zAgYAWh8LGgYAcx9xEwYAeh9zAgYAfx9zAgYAlR/RBwYAzh9zAgYA0x9zAgYAFyBzAgYAMSBzAgYArCAeFAYAuyBzAgYA
wSBzAgYAeCFzAgYAvCFzAgYA2iFzAgYA8SFzAgYA+iH2CgYABSL2CgYAECL2CgYAHSL2CgYASCIrIgYATyIrIgYAcSILGgYAhyILGgYApSKSIgYAziIeFAYA
BSMeFAYAXCMeFNMAdiMAAAYAuCOgCgYAFCT1EwYALiRzAgYATySSIgYAZyQeFAYAmSRzAgYArCRzAgYAwiRzAgYA6iRzAgYABSXRBwYAEiX2CgYAHyX1EwYA
XyVzAgYA0iVzAisAGiYAAAYAMyZxEwAAAAABAAAAAAABAAEAAQEQACwAAAAFAAEAAQABARAARQAAAAUABwAOAAEBEABkAAAABQAJABMAgQEQAIMAAAAFAAsA
GAALARAAogAAAAkAJwA6AAsBEACrAAAACQApADoACwEQAMYAAAAJADMAOgABARAA3AAAAAUANAA6AAEBEAADAQAABQA4AEIAAQEQACUBAAAFAEEAVQABARAA
QwEAAAUARABcAAEBEABfAQAABQBIAGUACwEQAIgBAAAJAHAAmQALAREAnAEAAAkAcwCZAAsBEACoAQAACQCFAJkACwEQALwBAAAJAIkAmQALARAAzAEAAAkA
iwCZAAsBEADYAQAACQCRAJkACwEQAPoBAAAJAJoAmQALARAAHwIAAAkAoACZAAsBEABDAgAACQCiAJkAAAAAADYgAAAFAKoAmQATAQAAeyAAAAkAqwCZAAMB
EADCIgAACQCrAJkAAQBYAzQAAQB2AzQAAQCOAzcAAQCqAzoAAQDCAz0AAQDkAzQAAQBSBDQAAQCOAzcAAQChBGgAAQC6BG0AVoDnBDcAVoD0BDcAVoACBTcA
VoAJBTcAVoAeBTcAVoAsBTcAVoA8BTcAVoBNBTcAVoBbBTcAVoBmBTcAVoB+BTcAVoCZBTcAVoC2BTcAVoDTBTcAVoDsBTcAUYAHBjcAUYAfBjcAVoA3BsUA
VoBMBsUAVoBhBsUAUYB1BsUAUYCJBsUAUYCYBsUAUYCwBsUAUYDPBjcAUYDkBjcAUYD0BjcAUYAKBzcABgDxCTcABgD1CTcABgD6CTcABgAJCsoBBgAWCsoB
BgAlCsoBBgAzCjcABgBGCjcABgBTCjcABgBfCjcABgBtCjcABgB7CjcABhCICm0AIQCTCs4BIQCYCtEBAQAjC/YBAQA/CzQAAQB5DMUAAQCUDDoAAQC6DDQA
AQCqAzoAAQDaDDQAAQDyDDQAAQAODTQAAQApDW0AAQBHDTQAAQBMDjcAAQBsDjcAAQCNDjcAAQB9DyQCAQCZDygCAQCzD20AAQDXDzQAUYAvEDcAUYBAEDcA
UYBbEDcAUYBsEDcAUYCBEDcAUYDnBDcAUYAsBTcAUYA8BTcAUYBNBTcAUYCVEDcAUYC3EDcAUYDDEDcAUYDmEMUAUYASEcUAUYA0EcUAUYBYETcAUYB7ETcA
UYCWETcAUYCyETcAUYDXETcAUYDlETcAUYDyETcAIQCTCs4BIQCZExkDAQCsEyIDAQC6EyIDAQDEEyIDAQDTEyUDAQDkEyUDAQANFCkDAQBJFC0DAQBeFG0A
AQBxFG0AAQB6FDQAAQD/FcUAAQCUDDoAAQC6DDQAAQATFpUDAQAzFpUDEQDfJb8HBgCFFsUABgCNFiIDBhCiFm0ABgCxFsUABgC0FjQABgC/FjQABgDJFjQA
BgDRFjcABgDVFjcABgDZFjcABgDhFjcABgDpFjcABgD3FjcABgAFFzcABgAVFzcABgAdF54DBgApF54DBgA1FyIDBgBBFyIDBgBLFyIDBgBWFyIDBgBgFyID
BgBpFyIDBgBxFzcABgB9FzcABgCIFzcABgCWFzcABgClF6EDBgC4F6EDBgDMF6EDBgDgF6EDBgDyF6EDBgAFGKEDBgAYGDoABgAwGDoABgBEGDcABgBPGKQD
BgBlGKQDBgB7GDcABgCOGKQDBgCXGDcABgClGDcABgC1GKcDBgDLGKsDBgDSGKQDBgDlGKQDBgD0GKQDBgAKGaQDBgAcGSIDBgAqGSIDBgA5GToABgBHGToA
BgBXGToABgBvGToABgCJGTcABgC3DjcABgDGDjcABgDWDjcAEwGYID0EBgD6IsUABgAcI4kFBgApI44FBgADHJUDBgAzI5IFBgBAI8UABgBMI20AAQCMI5YF
AQCbI84BBgCmI84BUCAAAAAAhgiXAgoAAQBYIAAAAACGCKgCDgABAGEgAAAAAIYIuQIKAAIAaSAAAAAAhgjEAg4AAgByIAAAAACGCM8CEwADAHogAAAAAIYI
3gIXAAMAgyAAAAAAhgjtAhwABACLIAAAAACGCPgCIAAEAJQgAAAAAIYIDAMlAAUAnCAAAAAAhgghAyoABQClIAAAAACGCDYDCgAGAK0gAAAAAIYIRAMOAAYA
tiAAAAAAhhhSAzAABwC+IAAAAACGCEAECgAHAMYgAAAAAIYISQQOAAcAzyAAAAAAhgjPAhMACADXIAAAAACGCN4CFwAIAOAgAAAAAIYYUgMwAAkA6CAAAAAA
hghtBFIACQDwIAAAAACGCHkEWAAJAPkgAAAAAIYIhQRfAAoAASEAAAAAhgiTBGMACgAKIQAAAACGGFIDMAALAAAAAACAAJEgQAfhAAsAAAAAAIAAkSBMB+0A
EgAAAAAAgACRIF0H8wAVAAAAAACAAJEgeAf8ABgAAAAAAIAAkSCTBwcBHQAAAAAAgACRILQHEAEiAAAAAACAAJEg6wcaAScAAAAAAIAAkSAFCCQBKwAAAAAA
gACRIA8IMAExAAAAAACAAJEgIAg2ATMAAAAAAIAAkSAwCEYBPAAAAAAAgACRIEEIUAFBAAAAAACAAJEgUQheAUkAEiEAAAAAkQCICGIBSQAfIQAAAACRAI4I
aAFKAGAhAAAAAJYAoAhtAUsAtCEAAAAAlgCwCHYBTgAEIgAAAACWAMIIdgFPAFQiAAAAAJYA1gh2AVAApCIAAAAAlgDnCHYBUQD0IgAAAACWAAQJdgFSAEQj
AAAAAJYAFwl8AVMAkCMAAAAAlgAtCXwBVQDcIwAAAACWAEEJhAFXAFwlAAAAAJYAXwmMAVkAtCUAAAAAlgBqCZIBWgAYKAAAAACWAIIJmwFdAJQpAAAAAJYA
lAmhAV4A8yoAAAAAlgCmCagBYAAYKwAAAACWALsJrQFhACQsAAAAAJYAwwm0AWIArCwAAAAAlgDMCbwBZACgLQAAAACWANQJwwFlANAtAAAAAJYA6gmbAWYA
nC4AAAAAhgi8CtUBZwCkLgAAAACBCMsK2gFnAK0uAAAAAIYI2goKAGgAtS4AAAAAgQjoCg4AaAC+LgAAAACGGFID4AFpALwwAAAAAIEACwvmAWoADDEAAAAA
hgARCwoAawBUMQAAAACWABoL7QFrAJwxAAAAAIYIbwv/AW4ApDEAAAAAhgh9CwMCbgCtMQAAAACGCIsLHABvALUxAAAAAIYIpAsgAG8AvjEAAAAAhgi9CwoA
cADGMQAAAACGCNALDgBwAM8xAAAAAIYI7QIcAHEA1zEAAAAAhgj4AiAAcQDgMQAAAACGCOMLCgByAOgxAAAAAIYI7gsOAHIA8TEAAAAAhgj5CwoAcwD5MQAA
AACGCAgMDgBzAAIyAAAAAIYIFwwKAHQACjIAAAAAhgglDA4AdAATMgAAAACGCDMMXwB1ABsyAAAAAIYIRAxjAHUAJDIAAAAAhghVDAoAdgAsMgAAAACGCGcM
DgB2ADUyAAAAAIYYUgMwAHcAPTIAAAAAhgjEDRMAdwBFMgAAAACGCNcNFwB3AE4yAAAAAIYI6g0TAHgAVjIAAAAAhgj+DRcAeABfMgAAAACGCBIOEwB5AGcy
AAAAAIYILw4XAHkAcDIAAAAAhhhSAzAAegB4MgAAAACGCO8ODAJ6AIAyAAAAAIYI/g4RAnoAiTIAAAAAhggNDxcCewCRMgAAAACGCBoPHQJ7AJoyAAAAAIYI
Jw9fAHwAojIAAAAAhgg+D2MAfACrMgAAAACGCFUPCgB9ALMyAAAAAIYIaQ8OAH0AvDIAAAAAhhhSAzAAfgAAAAAAgACRIP8RbwJ+AAAAAACAAJEgChJ7AoIA
AAAAAIAAkSBAB4IChQAAAAAAgACRIB8SjQKMAAAAAACAAJEgLhKgApYAAAAAAIAAkSA/EqYCmAAAAAAAgACRIFcSrgKcAAAAAACAAJEgcRK4AqEAAAAAAIAA
kSCKEr4CowAAAAAAgACRIJ0SxAKlAAAAAACAAJEgtBLMAqkAAAAAAIAAkSDOEtgCrgAAAAAAgACRIOkS4AKyAAAAAACAAJEg9hK+ArMAAAAAAIAAkSAHE+UC
tQAAAAAAgACRIBsT6wK3AAAAAACAAJEgLhPyArkAAAAAAIAAkSA+EwMDvgAAAAAAgACRIFkTDQPCAAAAAACAAJEgZRMUA8UAxDIAAAAAhgiKFP8BxgDMMgAA
AACBCJEUAwLGANUyAAAAAIYIiwscAMcA3TIAAAAAgQikCyAAxwDmMgAAAACGCL0LCgDIAO4yAAAAAIEI0AsOAMgA9zIAAAAAhgiYFDIDyQD/MgAAAACBCKsU
4AHJAAgzAAAAAIYIvhQyA8oAEDMAAAAAgQjQFOABygAZMwAAAACBGFIDMADLADczAAAAAJEA4hSoAcsARDMAAAAAkQDxFDcDzABcMwAAAACRAPwUPQPNAIwz
AAAAAJEACRVCA84AyDMAAAAAkQAbFUcDzwBENAAAAACRADEVTQPQAKA0AAAAAJEATBVWA9MAwzQAAAAAlgBXFWcD2ADQNAAAAACWAFcVcQPcAKQ5AAAAAIEA
XhUwAOEA5DkAAAAAgQByFTAA4QCgOwAAAACBAIEVhAPhAPg9AAAAAIEAlBUMAuQAoD4AAAAAhgCkFYsD5ADAPgAAAACGCLAVXwDlANQ+AAAAAIYIvhX/AeUA
ED8AAAAAhgDLFYsD5QCMPwAAAACGANsViwPmANA/AAAAAIYA6BWQA+cAfEEAAAAA5gH3FTAA5wCsPwAAAACRALIltwfnAOwuAAAAAOEB4SIwAOkArDAAAAAA
4QHqIoIF6QAAAAEAnRkAAAEAnRkAAAEAnRkAAAEAnRkAAAEAnRkAAAEAnRkAAAEAnRkAAAEAnRkAAAEAnRkAAAEAnRkAAAEAoxkAAAIArBkAAAMAuhkAAAQA
xBkAAAUA1xkAAAYA6xkAAAcA/hkAIAAAAAAAAAEASxoAAAIAxBkAIAAAAAAAAAEAUBoCAAIAVRoAIAAAAAAAAAEAUBoAAAIAbhoAAAMAgxoAAAQAkxoAIAAA
AAAAAAEAUBoAAAIAbhoAAAMAgxoAAAQAkxoAIAAAAAAAAAEAUBoAAAIAbhoAAAMAgxoAAAQAkxoAAAEAUBoAAAIASxoAAAMAnhoAAAQAqRoAIAAAAAAAAAEA
UBoAAAIArxoAAAMAthoCAAQAwxoAAAUA0BoAIAAAAAAAAAEAUBoAIAAAAAAAAAEA2xoAAAIA4hoAAAMA7hoAAAQA+hoAAAUAChsAAAYAFxsCAAcAKBsAAAgA
0BoAIAAAAAAAAAEAUBoAAAIANhsCAAMAPxsAAAQASxsAIAAAAAAAAAEAVhsAAAIAZBsAAAMAcRsCAAQAfxsAAAUArBkAIAYAjBsAAAcAmhsAAAEAohsAAAEA
SxoAAAEASxoAAAIArBsCAAMAtxsAAAEASxoAAAEASxoAAAEASxoAAAEASxoAAAEASxoAAAEASxoCAAIAtxsAAAEASxoCAAIAtxsAAAEAwRsAAAIAyBsAAAEA
wRsAAAEA0BsAAAIA1xsAAAMA5BsAAAEAwRsAAAEAwRsAAAIA7hsAAAEASxoAAAEAwRsAAAEAwRsAAAIA/RsAAAEAwRsAAAEAwRsAAAEAwRsAAAEAnRkAAAEA
nRkAAAEAAxwAAAEAAxwAAAEAChwAAAIAEBwAAAMAFxwAAAEAnRkAAAEAnRkAAAEAnRkAAAEAnRkAAAEAnRkAAAEAnRkAAAEAnRkAAAEAnRkAAAEAnRkAAAEA
nRkAAAEAnRkAAAEAnRkAAAEAnRkAAAEAnRkAAAEAnRkAAAEAnRkCAAEAKxwCAAIANBwAAAMAPhwAAAQATRwAAAEAwRsAAAIAUhwAAAMAqRoAAAEASxoAAAIA
VxwAAAMAXhwAAAQAxBkAAAUA1xkAAAYAqRoAAAcA/hkAAAEAZBwAAAIAdBwAAAMAgBwAAAQAkhwAAAUAoxwAAAYAshwAAAcAwBwAAAgAzBwAAAkA3RwCAAoA
6RwAAAEA/BwAAAIABx0AAAEADB0AAAIAEB0AAAMAVRoAAAQAIR0AAAEADB0AAAIAEB0AAAMAVRoAAAQAIR0CAAUAMx0AAAEADB0AAAIAQB0AAAEADB0AAAIA
SB0AAAEAUR0AAAIAXB0AAAMAcx0AAAQAgR0AAAEAxBMCAAIAmx0CAAMAcx0CAAQA0BoAAAUAqR0AAAEAxBMAAAIAmx0AAAMAcx0AAAQA0BoAAAEAth0AAAEA
QB0AAAIASB0AAAEAwRsAAAIAqR0AAAEAQB0CAAIASB0AAAEAQB0CAAIAvR0CAAMAxh0CAAQAyx0CAAUA0h0AAAEAQB0AAAIAqRoAAAMASxoAAAQATRwAAAEA
rBkAAAIAjBsAAAMA1x0AAAEAwRsAAAEAnRkAAAEAnRkAAAEAnRkAAAEAnRkAAAEAnRkAAAEAohsAAAEAnRkAAAEAQB0AAAEAQB0AAAEA4R0AAAEADB0AAAIA
EB0AAAMAnRkAAAEA6R0AAAIA9B0AAAMA1x0AAAQA+h0AAAUADx4AAAEAHh4AAAIAdBwAAAMAzBwAAAQALh4AAAEAHh4AAAIAdBwAAAMAzBwAAAQALh4AAAUA
6R0AAAEA1x0AAAIAQR4AAAMASx4AAAEAFxwAAAEAFxwAAAEASB0AAAEAxyUAAAIAzCUAAAEAsSMNAA0AGQDJAHEAUgOvA4EAUgMwAIkAUgMDApEAUgMwAJkA
UgMwAAkAUgMwAKEAUgMOAKkA9x63AzkAUgO7A7EAEB/BA7EA7QL/AbEAIx/GA7kAUgMOALEARx/LA8EAVR8iA8kAZR9fAMkA9xUwAAwAUgMwAOEAjB/jA+kA
nh/qA+kAqh/vA7EAtB/3AwwAwh/9AwwAxh8DBPEA5R8hBKkA9x8oBMkA/h9fALEACyD3A7EAKCA1BBEB1CBBBLEA5CBLBLEA7yDBA7EA/SA1BAkBCCFRBLEA
ESFWBLEAGyFbBLEARx9hBOkAIyFoBMEALCG3A6kANSFuBKkAQiFzBKkATCF6BMkAVyGBBKkAZyGHBMEAwh+OBKkAcyGUBCkBfiEKAMkAhyEwAKkAmCGdBOEA
pCG5BLEArSHABLEAtSE1BOEAIyHUBDEBwyHaBOEAIyHnBDEAUgMDAjEAzSH/ATkBfiH8BCEA4SEBBQkAfiEKAEEB9iETBUkBUgMhBVkBUgMDAmEBJCIsBVkB
xh8zBRkA9xUwAGkBVxVRBXEBXSJXBeEAfiFfBbEAaSJlBXkBUgN7BTEAUgMwAIkBUgMwAJEB4SIwAJEB6iKCBUkAvyOeBRQAySOyBRwA2CPEBSQA4yNfAJkB
8yPVBSQACiTrBbkBHCTwBTEAIiT3BbkBKSQABpkBOCQFBpkBRSQwAMkBUgMwAJkB6iKCBdEBUgMsBpkBVxVqBpkBgiRwBpkBiCTVAUEAkSSLBiwAUgMwAOEB
UgMOAOkBUgMOADEAIiSzBjEAIiS5BqkA1CTJBjwA4yTmBsEACyC4AsEAUgMDAvEBVR+kAykAUgP9BqkA8iQDBzEAUgMOAPkBUgMIBwECUgMOB8EAtB+4AgkC
UgM2B1kAUgM8B1kAKyVjAFkASQQOAFkAgiQwAMEAPCUcACwARCVVBywAwh9eB6kAUCV9BxECUgMOACEAeyWUByEAhiWZByEAliWfB1kArCWnBykBBibIBywA
ECb/ASwAJSbRB0QAQibmB0wATib7B0QA4SJfAFQAUgM2BxkBWCYICFkAXSZfAFkAaSaLA0kA9xUwAAkALAB6AAkAMAB/AAkANACEAAkAOACJAAkAPACOAAkA
QACTAAkARACYAAkASACdAAkATACTAAkAUAB6AAkAVACiAAkAWACnAAkAXACsAAkAYACxAAkAZAC2AAkAaAC7AAkAbADAAAgAcACYAAgAdACdAAgAeADIAAgA
fADNAAgAgACdAAgAhADSAAgAiADXAAkAjADcAAkAkADcAAkAlACYAAkAmADcAAkAIAHNAAkAJAGsAAkAKAE4AgkALAE9AgkAMAGTAAkANAF6AAkAOAGTAAkA
PAGYAAkAQAGdAAkARAFCAgkASAFHAgkATAFMAggAUAFRAggAVAFWAggAWAGTAAkAXAHNAAkAYAFbAgkAZAFRAgkAaAFgAgkAbAHcAAkAcAFlAgkAdAFqAiAA
KwCTACEAKwCTAC4AGwBACC4AIwBJCEAAKwCTAEEAKwCTAGAAKwCTAGEAKwCTAIAAKwCTAIEAKwCTAKAAKwCTAKEAKwCTAMAAKwCTAMEAKwCTAOAAKwCTAOEA
KwCTAAABKwCTAAEBKwCTACABKwCTACEBKwCTAEABKwCTAEEBKwCTAGABKwCTAIABKwCTAMABKwCTAOABKwCTAAACKwCTACACKwCTAGACKwCTAIACKwCTAKAC
KwCTAMACKwCTAOMCKwCTACMDKwCTAMEGKwCTAOEGKwCTAAEHKwCTACEHKwCTAEAHKwCTAEEHKwCTAGAHKwCTAGEHKwCTAIAHKwCTAIEHKwCTAKAHKwCTAKEH
KwCTAMEHKwCTAOAHywIyBuAHSwKTAOEHKwCTAAEIKwCTACEIKwCTAEAIKwCTAEEIKwCTAGAIKwCTAGEIKwCTAIAIKwCTAIEIKwCTAKAIKwCTAKEIKwCTAMAI
KwCTAMEIKwCTAOAIKwCTAOEIKwCTAAAJKwCTACAJKwCTAEAJKwCTAGAJKwCTAIAJKwCTAKAJKwCTAMAJKwCTAOAJKwCTAAAKKwCTACAKKwCTAEAKKwCTAGAK
KwCTAKAKKwCTAMAKKwCTAOAKKwCTAAALKwCTACALKwCTAEALKwCTAIALKwCTAKALKwCTAMALKwCTAOALKwCTAAAMKwCTACAMKwCTAEAMKwCTAGAMKwCTAEEN
KwCTAGENKwCTAIENKwCTAKENKwCTAMENKwCTAOENKwCTACAPKwCTAEAPKwCTAGAPKwCTAIAPKwCTAKAPKwCTAMAPKwCTAOAPKwCTAAAQKwCTACAQKwCTAEAQ
KwCTAAATKwCTAEATuwKTACUAtQMrALUDMQC1AzsAtQNFALUDVwC1A2MAtQNmALUDZwC1A3kAtQODALUDjwC1A+QAtQMBABQAAAAYANED1wMJBC4EogTFBO0E
BwUZBTgFSwVrBQwGfQaFBpMGogatBr8G1wYZB0MHZgeEB5AHrAfNBxwIOwgCAAEAAwAHAAQACQAJAAsACgANAAsAFgAMABkADQAdAAAA/wNBAAAADARBAAAA
EwRFAAAAHgRJAAAAJQRNAAAANgRBAAAAaARBAAAAEwRFAAAA1QRwAAAA3QR2AAAAWgv6AQAAZQtBAAAAZg0IAgAAcA1JAAAAhQ1BAAAAHgRJAAAA6glBAAAA
lA1BAAAAnw1BAAAAqQ12AAAAtg1BAAAAtw5FAAAAxg5FAAAA1g5FAAAA+A8tAgAAAxAyAgAADBB2AAAAHxBBAAAAUhYIAgAAcA1JAAAAhQ1BAAAAVRaZAwAA
ZBaZAwAAchZ2AAAAfBYIAgIAAQADAAEAAgADAAIAAwAFAAEABAAFAAIABQAHAAEABgAHAAIABwAJAAEACAAJAAIACQALAAEACgALAAIACwANAAEADAANAAIA
DgAPAAEADwAPAAEAEQARAAIAEAARAAIAEwATAAEAFAATAAIAFQAVAAEAFgAVAAIAOgAXAAEAOwAXAAEAPQAZAAIAPAAZAAIAQgAbAAEAQwAbAAEARQAdAAIA
RAAdAAEARwAfAAIARgAfAAIASAAhAAEASQAhAAEASwAjAAIASgAjAAIATAAlAAEATQAlAAIATgAnAAEATwAnAAIAUAApAAEAUQApAAEAUwArAAIAUgArAAIA
VQAtAAEAVgAtAAEAWAAvAAIAVwAvAAEAWgAxAAIAWQAxAAIAXAAzAAEAXQAzAAIAXgA1AAEAXwA1AAIAYAA3AAEAYQA3AAIAYgA5AAEAYwA5AAIAeQA7AAEA
egA7AAEAfAA9AAIAewA9AAIAfQA/AAEAfgA/AAEAgABBAAIAfwBBAAEAggBDAAIAgQBDAAIAkgBFAAIAkwBHABkAMgGVABkANAGXAOIe3AOrBb0FzgWaBsYG
3AbdB/IHAAhEATEAQAcBAEQBMwBMBwEAQAE1AF0HAQBAATcAeAcBAEABOQB4BwEAQAE7ALQHAQBEAT0A6wcBAEABPwAFCAEAQAFBAA8IAQBAAUMAIAgBAEAB
RQAwCAEAQAFHAEEIAQAAAUkAUQgBAEABywD/EQEAQAHNAAoSAQBEAc8AQAcBAEQB0QAfEgEAQAHTAC4SAQBAAdUAPxIBAEAB1wBXEgEAQAHZAHESAQBAAdsA
ihIBAEAB3QCdEgEAQAHfALQSAQBAAeEAzhIBAEAB4wDpEgEAQAHlAPYSAQBAAecABxMBAEAB6QAbEwEAQAHrAC4TAQBEAe0APhMBAEAB7wBZEwEAQAHxAGUT
AQCgJQAAqgAEgAAAAAAAAAAAAAAAAAAAAACWHgAABAAAAAAAAAAAAAAAAQBqAgAAAAAEAAAAAAAAAAAAAAABAHMCAAAAAAYABQAHAAUACAAFAA4ADQAPAA0A
EAANABEADQASAA0AEwANABQADQAVAA0AFgANABgAFwAZAAkAAAAYABMBQxWhAOAFtwB4BscA0gYSAfMGEgH4BgcBFwgBAAkAAAAAPE1vZHVsZT4ARm91bmRh
dGlvblZhbGlkYXRpb24uRW1iZWRkZWQuZGxsAEZvdW5kYXRpb25OYXRpdmVQYXRoSW5mbwBGb3VuZGF0aW9uTmF0aXZlRGlyZWN0b3J5RW50cnkARm91bmRh
dGlvbk5hdGl2ZURpcmVjdG9yeUJhdGNoAEZvdW5kYXRpb25WYWxpZGF0aW9uTmF0aXZlUGF0aABGSUxFVElNRQBCWV9IQU5ETEVfRklMRV9JTkZPUk1BVElP
TgBGSUxFX0RJU1BPU0lUSU9OX0lORk8ARm91bmRhdGlvblZhbGlkYXRpb25Bc3luY1N0cmVhbUNhcHR1cmUARm91bmRhdGlvbk5hdGl2ZUNvbXBsZXRpb25N
ZXNzYWdlAEZvdW5kYXRpb25OYXRpdmVKb2JBY2NvdW50aW5nAEZvdW5kYXRpb25OYXRpdmVKb2JTbmFwc2hvdABGb3VuZGF0aW9uVmFsaWRhdGlvbk5hdGl2
ZVByb2Nlc3NTZXNzaW9uAFNFQ1VSSVRZX0FUVFJJQlVURVMAU1RBUlRVUElORk8AUFJPQ0VTU19JTkZPUk1BVElPTgBGSUxFVElNRV9OQVRJVkUASU9fQ09V
TlRFUlMASk9CT0JKRUNUX0JBU0lDX0xJTUlUX0lORk9STUFUSU9OAEpPQk9CSkVDVF9FWFRFTkRFRF9MSU1JVF9JTkZPUk1BVElPTgBKT0JPQkpFQ1RfQVNT
T0NJQVRFX0NPTVBMRVRJT05fUE9SVABKT0JPQkpFQ1RfQkFTSUNfQUNDT1VOVElOR19JTkZPUk1BVElPTgBtc2NvcmxpYgBTeXN0ZW0AT2JqZWN0AFZhbHVl
VHlwZQBJRGlzcG9zYWJsZQBnZXRfVm9sdW1lU2VyaWFsAHNldF9Wb2x1bWVTZXJpYWwAZ2V0X0ZpbGVJZABzZXRfRmlsZUlkAGdldF9BdHRyaWJ1dGVzAHNl
dF9BdHRyaWJ1dGVzAGdldF9MZW5ndGgAc2V0X0xlbmd0aABEYXRlVGltZQBnZXRfTGFzdFdyaXRlVGltZVV0YwBzZXRfTGFzdFdyaXRlVGltZVV0YwBnZXRf
RmluYWxQYXRoAHNldF9GaW5hbFBhdGgALmN0b3IAPFZvbHVtZVNlcmlhbD5rX19CYWNraW5nRmllbGQAPEZpbGVJZD5rX19CYWNraW5nRmllbGQAPEF0dHJp
YnV0ZXM+a19fQmFja2luZ0ZpZWxkADxMZW5ndGg+a19fQmFja2luZ0ZpZWxkADxMYXN0V3JpdGVUaW1lVXRjPmtfX0JhY2tpbmdGaWVsZAA8RmluYWxQYXRo
PmtfX0JhY2tpbmdGaWVsZABWb2x1bWVTZXJpYWwARmlsZUlkAEF0dHJpYnV0ZXMATGVuZ3RoAExhc3RXcml0ZVRpbWVVdGMARmluYWxQYXRoAGdldF9OYW1l
AHNldF9OYW1lADxOYW1lPmtfX0JhY2tpbmdGaWVsZABOYW1lAGdldF9FbnRyaWVzAHNldF9FbnRyaWVzAGdldF9Db21wbGV0ZWQAc2V0X0NvbXBsZXRlZAA8
RW50cmllcz5rX19CYWNraW5nRmllbGQAPENvbXBsZXRlZD5rX19CYWNraW5nRmllbGQARW50cmllcwBDb21wbGV0ZWQAR0VORVJJQ19SRUFEAEdFTkVSSUNf
V1JJVEUAREVMRVRFAEZJTEVfUkVBRF9BVFRSSUJVVEVTAEZJTEVfVFJBVkVSU0UARklMRV9TSEFSRV9SRUFEAEZJTEVfU0hBUkVfV1JJVEUAT1BFTl9FWElT
VElORwBDUkVBVEVfTkVXAEZJTEVfRkxBR19XUklURV9USFJPVUdIAEZJTEVfRkxBR19CQUNLVVBfU0VNQU5USUNTAEZJTEVfRkxBR19PUEVOX1JFUEFSU0Vf
UE9JTlQARklMRV9BVFRSSUJVVEVfUkVQQVJTRV9QT0lOVABGSUxFX0FUVFJJQlVURV9ESVJFQ1RPUlkASU9fUkVQQVJTRV9UQUdfTU9VTlRfUE9JTlQARlND
VExfR0VUX1JFUEFSU0VfUE9JTlQARlNDVExfU0VUX1JFUEFSU0VfUE9JTlQARVJST1JfRklMRV9OT1RfRk9VTkQARVJST1JfUEFUSF9OT1RfRk9VTkQARVJS
T1JfTk9fTU9SRV9GSUxFUwBGaWxlRGlzcG9zaXRpb25JbmZvAEZpbGVSZW5hbWVJbmZvAEZpbGVJZEJvdGhEaXJlY3RvcnlJbmZvAEZpbGVJZEJvdGhEaXJl
Y3RvcnlSZXN0YXJ0SW5mbwBGSUxFX05BTUVfTk9STUFMSVpFRABWT0xVTUVfTkFNRV9ET1MARFVQTElDQVRFX1NBTUVfQUNDRVNTAEZJTEVfQkVHSU4ATWlj
cm9zb2Z0LldpbjMyLlNhZmVIYW5kbGVzAFNhZmVGaWxlSGFuZGxlAENyZWF0ZUZpbGVXAENyZWF0ZURpcmVjdG9yeVcAR2V0RmlsZUluZm9ybWF0aW9uQnlI
YW5kbGUAU2V0RmlsZUluZm9ybWF0aW9uQnlIYW5kbGUAU2V0RmlsZUluZm9ybWF0aW9uQnlIYW5kbGVCdWZmZXIAR2V0RmlsZUluZm9ybWF0aW9uQnlIYW5k
bGVFeABTeXN0ZW0uVGV4dABTdHJpbmdCdWlsZGVyAEdldEZpbmFsUGF0aE5hbWVCeUhhbmRsZVcAV3JpdGVGaWxlAEZsdXNoRmlsZUJ1ZmZlcnMARGV2aWNl
SW9Db250cm9sAFNldEZpbGVQb2ludGVyRXgARHVwbGljYXRlSGFuZGxlAEdldEN1cnJlbnRQcm9jZXNzAFN5c3RlbS5Db21wb25lbnRNb2RlbABXaW4zMkV4
Y2VwdGlvbgBFcnJvcgBFeHRlbmRlZExvY2FsUGF0aABUcnlPcGVuTWV0YWRhdGEAT3BlbkltbXV0YWJsZVJlYWQAQ3JlYXRlTmV3UGlubmVkRmlsZQBPcGVu
UmVuYW1lUGFyZW50AE9wZW5Xcml0YWJsZVJlcGFyc2VEaXJlY3RvcnkAT3BlbkRlbGV0ZU5vRm9sbG93AFRyeU9wZW5EZWxldGVOb0ZvbGxvdwBUcnlPcGVu
UmVhZE5vRm9sbG93AEVudW1lcmF0ZURpcmVjdG9yeUhhbmRsZUJhdGNoAE1hcmtEZWxldGUAUmVuYW1lUmVsYXRpdmVOb1JlcGxhY2UAR2V0SnVuY3Rpb25U
YXJnZXQAU2V0SnVuY3Rpb25UYXJnZXQAQ3JlYXRlRGlyZWN0b3J5RXhhY3QAR2V0SW5mbwBXcml0ZUFsbABSZWFkQWxsAER1cGxpY2F0ZVBpbm5lZEhhbmRs
ZQBTaGEyNTYATG93AEhpZ2gARmlsZUF0dHJpYnV0ZXMAQ3JlYXRpb25UaW1lAExhc3RBY2Nlc3NUaW1lAExhc3RXcml0ZVRpbWUAVm9sdW1lU2VyaWFsTnVt
YmVyAEZpbGVTaXplSGlnaABGaWxlU2l6ZUxvdwBOdW1iZXJPZkxpbmtzAEZpbGVJbmRleEhpZ2gARmlsZUluZGV4TG93AERlbGV0ZUZpbGUAc3luYwBidWls
ZGVyAFN5c3RlbS5UaHJlYWRpbmcuVGFza3MAVGFzawBnZXRfQ29tcGxldGlvbgBzZXRfQ29tcGxldGlvbgBnZXRfRXJyb3JUZXh0AHNldF9FcnJvclRleHQA
U3lzdGVtLklPAFRleHRSZWFkZXIARHJhaW4AU25hcHNob3QAV2FpdEJvdGgAPENvbXBsZXRpb24+a19fQmFja2luZ0ZpZWxkADxFcnJvclRleHQ+a19fQmFj
a2luZ0ZpZWxkAENvbXBsZXRpb24ARXJyb3JUZXh0AGdldF9Qcm9jZXNzSWQAc2V0X1Byb2Nlc3NJZABnZXRfU3RhcnRUaW1lRmlsZVRpbWVVdGMAc2V0X1N0
YXJ0VGltZUZpbGVUaW1lVXRjAGdldF9FeGVjdXRhYmxlUGF0aABzZXRfRXhlY3V0YWJsZVBhdGgAZ2V0X1NoYTI1NgBzZXRfU2hhMjU2AGdldF9GaXJzdEV2
ZW50AHNldF9GaXJzdEV2ZW50AGdldF9MYXN0RXZlbnQAc2V0X0xhc3RFdmVudABnZXRfRXhpdE9ic2VydmVkAHNldF9FeGl0T2JzZXJ2ZWQAZ2V0X0lkZW50
aXR5RXJyb3IAc2V0X0lkZW50aXR5RXJyb3IAPFByb2Nlc3NJZD5rX19CYWNraW5nRmllbGQAPFN0YXJ0VGltZUZpbGVUaW1lVXRjPmtfX0JhY2tpbmdGaWVs
ZAA8RXhlY3V0YWJsZVBhdGg+a19fQmFja2luZ0ZpZWxkADxTaGEyNTY+a19fQmFja2luZ0ZpZWxkADxGaXJzdEV2ZW50PmtfX0JhY2tpbmdGaWVsZAA8TGFz
dEV2ZW50PmtfX0JhY2tpbmdGaWVsZAA8RXhpdE9ic2VydmVkPmtfX0JhY2tpbmdGaWVsZAA8SWRlbnRpdHlFcnJvcj5rX19CYWNraW5nRmllbGQAUHJvY2Vz
c0lkAFN0YXJ0VGltZUZpbGVUaW1lVXRjAEV4ZWN1dGFibGVQYXRoAEZpcnN0RXZlbnQATGFzdEV2ZW50AEV4aXRPYnNlcnZlZABJZGVudGl0eUVycm9yAGdl
dF9Ub3RhbFByb2Nlc3NlcwBzZXRfVG90YWxQcm9jZXNzZXMAZ2V0X0FjdGl2ZVByb2Nlc3NlcwBzZXRfQWN0aXZlUHJvY2Vzc2VzAGdldF9Ub3RhbFRlcm1p
bmF0ZWRQcm9jZXNzZXMAc2V0X1RvdGFsVGVybWluYXRlZFByb2Nlc3NlcwA8VG90YWxQcm9jZXNzZXM+a19fQmFja2luZ0ZpZWxkADxBY3RpdmVQcm9jZXNz
ZXM+a19fQmFja2luZ0ZpZWxkADxUb3RhbFRlcm1pbmF0ZWRQcm9jZXNzZXM+a19fQmFja2luZ0ZpZWxkAFRvdGFsUHJvY2Vzc2VzAEFjdGl2ZVByb2Nlc3Nl
cwBUb3RhbFRlcm1pbmF0ZWRQcm9jZXNzZXMAZ2V0X0FjY291bnRpbmcAc2V0X0FjY291bnRpbmcAZ2V0X01lc3NhZ2VzAHNldF9NZXNzYWdlcwBnZXRfQWN0
aXZlWmVyb09ic2VydmVkAHNldF9BY3RpdmVaZXJvT2JzZXJ2ZWQAZ2V0X0NvbXBsZXRpb25FcnJvcgBzZXRfQ29tcGxldGlvbkVycm9yADxBY2NvdW50aW5n
PmtfX0JhY2tpbmdGaWVsZAA8TWVzc2FnZXM+a19fQmFja2luZ0ZpZWxkADxBY3RpdmVaZXJvT2JzZXJ2ZWQ+a19fQmFja2luZ0ZpZWxkADxDb21wbGV0aW9u
RXJyb3I+a19fQmFja2luZ0ZpZWxkAEFjY291bnRpbmcATWVzc2FnZXMAQWN0aXZlWmVyb09ic2VydmVkAENvbXBsZXRpb25FcnJvcgBDUkVBVEVfU1VTUEVO
REVEAENSRUFURV9VTklDT0RFX0VOVklST05NRU5UAENSRUFURV9OT19XSU5ET1cAU1RBUlRGX1VTRVNUREhBTkRMRVMASEFORExFX0ZMQUdfSU5IRVJJVABQ
Uk9DRVNTX1FVRVJZX0xJTUlURURfSU5GT1JNQVRJT04AU1lOQ0hST05JWkUASk9CX09CSkVDVF9MSU1JVF9LSUxMX09OX0pPQl9DTE9TRQBKb2JPYmplY3RB
c3NvY2lhdGVDb21wbGV0aW9uUG9ydEluZm9ybWF0aW9uAEpvYk9iamVjdEV4dGVuZGVkTGltaXRJbmZvcm1hdGlvbgBKb2JPYmplY3RCYXNpY0FjY291bnRp
bmdJbmZvcm1hdGlvbgBKT0JfT0JKRUNUX01TR19BQ1RJVkVfUFJPQ0VTU19aRVJPAEpPQl9PQkpFQ1RfTVNHX05FV19QUk9DRVNTAEpPQl9PQkpFQ1RfTVNH
X0VYSVRfUFJPQ0VTUwBKT0JfT0JKRUNUX01TR19BQk5PUk1BTF9FWElUX1BST0NFU1MAV0FJVF9PQkpFQ1RfMABXQUlUX1RJTUVPVVQAU1RJTExfQUNUSVZF
AENyZWF0ZVBpcGUAU2V0SGFuZGxlSW5mb3JtYXRpb24AQ3JlYXRlUHJvY2Vzc1cAQ3JlYXRlSm9iT2JqZWN0VwBTZXRJbmZvcm1hdGlvbkpvYk9iamVjdABR
dWVyeUluZm9ybWF0aW9uSm9iT2JqZWN0AEFzc2lnblByb2Nlc3NUb0pvYk9iamVjdABUZXJtaW5hdGVKb2JPYmplY3QAQ3JlYXRlSW9Db21wbGV0aW9uUG9y
dABHZXRRdWV1ZWRDb21wbGV0aW9uU3RhdHVzAFBvc3RRdWV1ZWRDb21wbGV0aW9uU3RhdHVzAFJlc3VtZVRocmVhZABUZXJtaW5hdGVQcm9jZXNzAFdhaXRG
b3JTaW5nbGVPYmplY3QAR2V0RXhpdENvZGVQcm9jZXNzAEdldFByb2Nlc3NUaW1lcwBRdWVyeUZ1bGxQcm9jZXNzSW1hZ2VOYW1lVwBPcGVuUHJvY2VzcwBD
bG9zZUhhbmRsZQBTeXN0ZW0uQ29sbGVjdGlvbnMuR2VuZXJpYwBEaWN0aW9uYXJ5YDIAY29tcGxldGlvbk1lc3NhZ2VzAHByb2Nlc3NIYW5kbGUAam9iSGFu
ZGxlAGNvbXBsZXRpb25Qb3J0AHN0ZG91dFJlYWRIYW5kbGUAc3RkZXJyUmVhZEhhbmRsZQBTeXN0ZW0uVGhyZWFkaW5nAFRocmVhZABjb21wbGV0aW9uVGhy
ZWFkAFN5c3RlbS5SdW50aW1lLkNvbXBpbGVyU2VydmljZXMASXNWb2xhdGlsZQBzdG9wQ29tcGxldGlvblRocmVhZABhY3RpdmVaZXJvT2JzZXJ2ZWQAZGlz
cG9zZWQAY29tcGxldGlvbkVycm9yAGdldF9JZABzZXRfSWQAZ2V0X1N0YW5kYXJkT3V0cHV0AHNldF9TdGFuZGFyZE91dHB1dABnZXRfU3RhbmRhcmRFcnJv
cgBzZXRfU3RhbmRhcmRFcnJvcgBUaHJvd0xhc3RFcnJvcgBUb0ZpbGVUaW1lAEdldFN0YXJ0VGltZQBHZXRFeGVjdXRhYmxlUGF0aABCdWlsZEVudmlyb25t
ZW50QmxvY2sAU2V0Sm9iSW5mb3JtYXRpb24AVABGdW5jYDUAUHJvYmVGYXVsdABDcmVhdGUAU3RhcnRDb21wbGV0aW9uUHVtcABDb21wbGV0aW9uUHVtcABS
ZWNvcmRQcm9jZXNzRXZlbnQAUXVlcnlBY2NvdW50aW5nAFdhaXRGb3JFeGl0AGdldF9IYXNFeGl0ZWQAZ2V0X0V4aXRDb2RlAFdhaXRGb3JKb2JFbXB0eQBU
ZXJtaW5hdGVKb2IAR2V0Sm9iU25hcHNob3QARGlzcG9zZQA8SWQ+a19fQmFja2luZ0ZpZWxkADxTdGFuZGFyZE91dHB1dD5rX19CYWNraW5nRmllbGQAPFN0
YW5kYXJkRXJyb3I+a19fQmFja2luZ0ZpZWxkAElkAFN0YW5kYXJkT3V0cHV0AFN0YW5kYXJkRXJyb3IASGFzRXhpdGVkAEV4aXRDb2RlAG5MZW5ndGgAbHBT
ZWN1cml0eURlc2NyaXB0b3IAYkluaGVyaXRIYW5kbGUAY2IAbHBSZXNlcnZlZABscERlc2t0b3AAbHBUaXRsZQBkd1gAZHdZAGR3WFNpemUAZHdZU2l6ZQBk
d1hDb3VudENoYXJzAGR3WUNvdW50Q2hhcnMAZHdGaWxsQXR0cmlidXRlAGR3RmxhZ3MAd1Nob3dXaW5kb3cAY2JSZXNlcnZlZDIAbHBSZXNlcnZlZDIAaFN0
ZElucHV0AGhTdGRPdXRwdXQAaFN0ZEVycm9yAGhQcm9jZXNzAGhUaHJlYWQAZHdQcm9jZXNzSWQAZHdUaHJlYWRJZABkd0xvd0RhdGVUaW1lAGR3SGlnaERh
dGVUaW1lAFJlYWRPcGVyYXRpb25Db3VudABXcml0ZU9wZXJhdGlvbkNvdW50AE90aGVyT3BlcmF0aW9uQ291bnQAUmVhZFRyYW5zZmVyQ291bnQAV3JpdGVU
cmFuc2ZlckNvdW50AE90aGVyVHJhbnNmZXJDb3VudABQZXJQcm9jZXNzVXNlclRpbWVMaW1pdABQZXJKb2JVc2VyVGltZUxpbWl0AExpbWl0RmxhZ3MATWlu
aW11bVdvcmtpbmdTZXRTaXplAE1heGltdW1Xb3JraW5nU2V0U2l6ZQBBY3RpdmVQcm9jZXNzTGltaXQAQWZmaW5pdHkAUHJpb3JpdHlDbGFzcwBTY2hlZHVs
aW5nQ2xhc3MAQmFzaWNMaW1pdEluZm9ybWF0aW9uAElvSW5mbwBQcm9jZXNzTWVtb3J5TGltaXQASm9iTWVtb3J5TGltaXQAUGVha1Byb2Nlc3NNZW1vcnlV
c2VkAFBlYWtKb2JNZW1vcnlVc2VkAENvbXBsZXRpb25LZXkAQ29tcGxldGlvblBvcnQAVG90YWxVc2VyVGltZQBUb3RhbEtlcm5lbFRpbWUAVGhpc1Blcmlv
ZFRvdGFsVXNlclRpbWUAVGhpc1BlcmlvZFRvdGFsS2VybmVsVGltZQBUb3RhbFBhZ2VGYXVsdENvdW50AHZhbHVlAGZpbGVOYW1lAGRlc2lyZWRBY2Nlc3MA
c2hhcmVNb2RlAHNlY3VyaXR5QXR0cmlidXRlcwBjcmVhdGlvbkRpc3Bvc2l0aW9uAGZsYWdzQW5kQXR0cmlidXRlcwB0ZW1wbGF0ZUZpbGUAU3lzdGVtLlJ1
bnRpbWUuSW50ZXJvcFNlcnZpY2VzAE1hcnNoYWxBc0F0dHJpYnV0ZQBVbm1hbmFnZWRUeXBlAHBhdGgAZmlsZQBpbmZvcm1hdGlvbgBPdXRBdHRyaWJ1dGUA
ZmlsZUluZm9ybWF0aW9uQ2xhc3MAZmlsZUluZm9ybWF0aW9uAGJ1ZmZlclNpemUAcGF0aExlbmd0aABmbGFncwBidWZmZXIAYnl0ZXNUb1dyaXRlAGJ5dGVz
V3JpdHRlbgBvdmVybGFwcGVkAGRldmljZQBjb250cm9sQ29kZQBpbnB1dEJ1ZmZlcgBpbnB1dEJ1ZmZlclNpemUAb3V0cHV0QnVmZmVyAG91dHB1dEJ1ZmZl
clNpemUAYnl0ZXNSZXR1cm5lZABkaXN0YW5jZQBuZXdQb3NpdGlvbgBtb3ZlTWV0aG9kAHNvdXJjZVByb2Nlc3MAc291cmNlSGFuZGxlAHRhcmdldFByb2Nl
c3MAdGFyZ2V0SGFuZGxlAGluaGVyaXRIYW5kbGUAb3B0aW9ucwBvcGVyYXRpb24Ac2hhcmVXcml0ZQBlcnJvckNvZGUAaGFuZGxlAHJlc3RhcnQAc291cmNl
AHBpbm5lZFBhcmVudABmaW5hbExlYWYAYWJzb2x1dGVUYXJnZXQAYnl0ZXMAcmVhZGVyAGZpcnN0AHNlY29uZAB0aW1lb3V0TWlsbGlzZWNvbmRzAHJlYWRQ
aXBlAHdyaXRlUGlwZQBwaXBlQXR0cmlidXRlcwBzaXplAG1hc2sAYWNjZXNzAHNoYXJlAGFwcGxpY2F0aW9uTmFtZQBjb21tYW5kTGluZQBwcm9jZXNzQXR0
cmlidXRlcwB0aHJlYWRBdHRyaWJ1dGVzAGluaGVyaXRIYW5kbGVzAGNyZWF0aW9uRmxhZ3MAZW52aXJvbm1lbnQAY3VycmVudERpcmVjdG9yeQBzdGFydHVw
SW5mbwBwcm9jZXNzSW5mb3JtYXRpb24AYXR0cmlidXRlcwBuYW1lAGpvYgBpbmZvcm1hdGlvbkNsYXNzAGluZm9ybWF0aW9uTGVuZ3RoAHJldHVybkxlbmd0
aABwcm9jZXNzAGV4aXRDb2RlAGZpbGVIYW5kbGUAZXhpc3RpbmdDb21wbGV0aW9uUG9ydABjb21wbGV0aW9uS2V5AG51bWJlck9mQ29uY3VycmVudFRocmVh
ZHMAbnVtYmVyT2ZCeXRlcwBtaWxsaXNlY29uZHMAdGhyZWFkAGNyZWF0aW9uAGV4aXQAa2VybmVsAHVzZXIAcHJvY2Vzc0lkAGVudHJpZXMAZmF1bHRQcm9i
ZQBwaGFzZQBzdGFydFRpbWVGaWxlVGltZVV0YwBleGVjdXRhYmxlUGF0aABhcHBsaWNhdGlvblBhdGgAZW52aXJvbm1lbnRFbnRyaWVzAGV2ZW50TmFtZQBl
eGl0T2JzZXJ2ZWQAQ29tcGlsYXRpb25SZWxheGF0aW9uc0F0dHJpYnV0ZQBSdW50aW1lQ29tcGF0aWJpbGl0eUF0dHJpYnV0ZQBGb3VuZGF0aW9uVmFsaWRh
dGlvbi5FbWJlZGRlZABDb21waWxlckdlbmVyYXRlZEF0dHJpYnV0ZQBEbGxJbXBvcnRBdHRyaWJ1dGUAa2VybmVsMzIuZGxsAE1hcnNoYWwAR2V0TGFzdFdp
bjMyRXJyb3IAU3RyaW5nAElzTnVsbE9yV2hpdGVTcGFjZQBnZXRfQ2hhcnMASW52YWxpZE9wZXJhdGlvbkV4Y2VwdGlvbgBDb25jYXQASW50UHRyAFplcm8A
U2FmZUhhbmRsZQBnZXRfSXNJbnZhbGlkAExpc3RgMQBCeXRlAEJpdENvbnZlcnRlcgBUb1VJbnQzMgBFbmNvZGluZwBnZXRfVW5pY29kZQBHZXRTdHJpbmcA
b3BfSW5lcXVhbGl0eQBBZGQAVG9BcnJheQBUeXBlAFJ1bnRpbWVUeXBlSGFuZGxlAEdldFR5cGVGcm9tSGFuZGxlAFNpemVPZgBnZXRfSXNDbG9zZWQAb3Bf
RXF1YWxpdHkAU3RyaW5nQ29tcGFyaXNvbgBFbmRzV2l0aABDaGFyADxQcml2YXRlSW1wbGVtZW50YXRpb25EZXRhaWxzPntFQTBFOTVFNS01RDdGLTRCREYt
QUZDMi03RTJFMjlGQzMzNjl9AF9fU3RhdGljQXJyYXlJbml0VHlwZVNpemU9MjAAJCRtZXRob2QweDYwMDAwMzEtMQBSdW50aW1lSGVscGVycwBBcnJheQBS
dW50aW1lRmllbGRIYW5kbGUASW5pdGlhbGl6ZUFycmF5AEluZGV4T2ZBbnkASXNOdWxsT3JFbXB0eQBTdGFydHNXaXRoAElzTGV0dGVyAFN1YnN0cmluZwBU
cmltRW5kAEdldEJ5dGVzAGdldF9TaXplAEFsbG9jSEdsb2JhbABXcml0ZUJ5dGUAV3JpdGVJbnQzMgBEYW5nZXJvdXNBZGRSZWYAV3JpdGVJbnRQdHIAQ29w
eQBJbnQzMgBUb1N0cmluZwBEYW5nZXJvdXNSZWxlYXNlAEZyZWVIR2xvYmFsAFRvVUludDE2AEluZGV4T2YARXF1YWxzAEJ1ZmZlcgBCbG9ja0NvcHkAZ2V0
X0NhcGFjaXR5AFVJbnQzMgBGcm9tRmlsZVRpbWVVdGMATWF0aABNaW4ARmlsZVN0cmVhbQBGaWxlQWNjZXNzAE1lbW9yeVN0cmVhbQBTdHJlYW0AQ29weVRv
AFN5c3RlbS5TZWN1cml0eS5DcnlwdG9ncmFwaHkAU0hBMjU2AEhhc2hBbGdvcml0aG0AQ29tcHV0ZUhhc2gAUmVwbGFjZQBTdHJ1Y3RMYXlvdXRBdHRyaWJ1
dGUATGF5b3V0S2luZABTeXN0ZW0uRGlhZ25vc3RpY3MARGVidWdnZXJTdGVwVGhyb3VnaEF0dHJpYnV0ZQA8RHJhaW4+ZF9fMQBJQXN5bmNTdGF0ZU1hY2hp
bmUATW92ZU5leHQAU2V0U3RhdGVNYWNoaW5lADw+MV9fc3RhdGUAQXN5bmNUYXNrTWV0aG9kQnVpbGRlcgA8PnRfX2J1aWxkZXIAPD40X190aGlzADxidWZm
ZXI+NV9fMgA8Y291bnQ+NV9fMwA8PnNfX0xvY2tUYWtlbjAAQ29uZmlndXJlZFRhc2tBd2FpdGFibGVgMQBDb25maWd1cmVkVGFza0F3YWl0ZXIAPD51X18k
YXdhaXRlcjQAPD50X19zdGFjawA8PjdfX3dyYXA1AHBhcmFtMABUYXNrYDEAUmVhZEFzeW5jAENvbmZpZ3VyZUF3YWl0AEdldEF3YWl0ZXIAZ2V0X0lzQ29t
cGxldGVkAEF3YWl0VW5zYWZlT25Db21wbGV0ZWQAR2V0UmVzdWx0AE1vbml0b3IARW50ZXIAQXBwZW5kAEV4aXQARXhjZXB0aW9uAFNldEV4Y2VwdGlvbgBT
ZXRSZXN1bHQARGVidWdnZXJIaWRkZW5BdHRyaWJ1dGUAQXN5bmNTdGF0ZU1hY2hpbmVBdHRyaWJ1dGUAU3RhcnQAZ2V0X1Rhc2sAV2FpdEFsbABBZ2dyZWdh
dGVFeGNlcHRpb24AQXJndW1lbnROdWxsRXhjZXB0aW9uAEFyZ3VtZW50RXhjZXB0aW9uAFN0cnVjdHVyZVRvUHRyAEludm9rZQBVSW50UHRyAFN0cmluZ1Rv
SEdsb2JhbFVuaQBVVEY4RW5jb2RpbmcAU3RyZWFtUmVhZGVyAFRocmVhZFN0YXJ0AHNldF9Jc0JhY2tncm91bmQAVG9JbnQ2NABUcnlHZXRWYWx1ZQBQdHJU
b1N0cnVjdHVyZQBBcmd1bWVudE91dE9mUmFuZ2VFeGNlcHRpb24AZ2V0X1V0Y05vdwBBZGRNaWxsaXNlY29uZHMAb3BfR3JlYXRlclRoYW5PckVxdWFsAFNs
ZWVwADxHZXRKb2JTbmFwc2hvdD5iX184AGxlZnQAcmlnaHQAQ29tcGFyaXNvbmAxAENTJDw+OV9fQ2FjaGVkQW5vbnltb3VzTWV0aG9kRGVsZWdhdGU5AENv
bXBhcmVUbwBnZXRfQ291bnQARW51bWVyYXRvcgBHZXRFbnVtZXJhdG9yAEtleVZhbHVlUGFpcmAyAGdldF9DdXJyZW50AGdldF9WYWx1ZQBTb3J0AGdldF9J
c0FsaXZlAEpvaW4AAAAAM1AAQQBUAEgAXwBPAFUAVABTAEkARABFAF8AQQBMAEwATwBXAEUARABfAFIATwBPAFQAAAlcAFwAPwBcAABHQwByAGUAYQB0AGUA
RgBpAGwAZQBXACAAaQBtAG0AdQB0AGEAYgBsAGUAIAByAGUAYQBkACAAZgBhAGkAbABlAGQAOgAgAAA9QwByAGUAYQB0AGUARgBpAGwAZQBXACAAQwByAGUA
YQB0AGUATgBlAHcAIABmAGEAaQBsAGUAZAA6ACAAAEVDAHIAZQBhAHQAZQBGAGkAbABlAFcAIAByAGUAbgBhAG0AZQAgAHAAYQByAGUAbgB0ACAAZgBhAGkA
bABlAGQAOgAgAABfQwByAGUAYQB0AGUARgBpAGwAZQBXACAAdwByAGkAdABhAGIAbABlACAAcgBlAHAAYQByAHMAZQAgAGQAaQByAGUAYwB0AG8AcgB5ACAA
ZgBhAGkAbABlAGQAOgAgAABLQwByAGUAYQB0AGUARgBpAGwAZQBXACAAZABlAGwAZQB0AGUAIABuAG8ALQBmAG8AbABsAG8AdwAgAGYAYQBpAGwAZQBkADoA
IAABd0cAZQB0AEYAaQBsAGUASQBuAGYAbwByAG0AYQB0AGkAbwBuAEIAeQBIAGEAbgBkAGwAZQBFAHgAIABGAGkAbABlAEkAZABCAG8AdABoAEQAaQByAGUA
YwB0AG8AcgB5AEkAbgBmAG8AIABmAGEAaQBsAGUAZAAAY1AAQQBUAEgAXwBPAFAARQBSAEEAVABJAE8ATgBfAEYAQQBJAEwARQBEADoAIABtAGEAbABmAG8A
cgBtAGUAZAAgAGQAaQByAGUAYwB0AG8AcgB5ACAAcgBlAGMAbwByAGQAAF9QAEEAVABIAF8ATwBQAEUAUgBBAFQASQBPAE4AXwBGAEEASQBMAEUARAA6ACAA
bQBhAGwAZgBvAHIAbQBlAGQAIABkAGkAcgBlAGMAdABvAHIAeQAgAG4AYQBtAGUAAAMuAAAFLgAuAABjUABBAFQASABfAE8AUABFAFIAQQBUAEkATwBOAF8A
RgBBAEkATABFAEQAOgAgAG0AYQBsAGYAbwByAG0AZQBkACAAZABpAHIAZQBjAHQAbwByAHkAIABvAGYAZgBzAGUAdAAAa1MAZQB0AEYAaQBsAGUASQBuAGYA
bwByAG0AYQB0AGkAbwBuAEIAeQBIAGEAbgBkAGwAZQAgAEYAaQBsAGUARABpAHMAcABvAHMAaQB0AGkAbwBuAEkAbgBmAG8AIABmAGEAaQBsAGUAZAAAAyAA
ADlSAEUAUABPAFIAVABfAEEAUgBUAEkARgBBAEMAVABfAFAAQQBUAEgAXwBJAE4AVgBBAEwASQBEAABLUgBFAFAATwBSAFQAXwBUAEEAUgBHAEUAVABfAFAA
QQBSAEUATgBUAF8ASQBEAEUATgBUAEkAVABZAF8ASQBOAFYAQQBMAEkARAAAA1wAAGVTAGUAdABGAGkAbABlAEkAbgBmAG8AcgBtAGEAdABpAG8AbgBCAHkA
SABhAG4AZABsAGUAIABGAGkAbABlAFIAZQBuAGEAbQBlAEkAbgBmAG8AIABmAGEAaQBsAGUAZAA6ACAAAD1GAFMAQwBUAEwAXwBHAEUAVABfAFIARQBQAEEA
UgBTAEUAXwBQAE8ASQBOAFQAIABmAGEAaQBsAGUAZAAAY1IAVQBOAFQASQBNAEUAXwBJAEQARQBOAFQASQBUAFkAXwBJAE4AVgBBAEwASQBEADoAIAB1AG4A
cwB1AHAAcABvAHIAdABlAGQAIAByAGUAcABhAHIAcwBlACAAdABhAGcAAGdSAFUATgBUAEkATQBFAF8ASQBEAEUATgBUAEkAVABZAF8ASQBOAFYAQQBMAEkA
RAA6ACAAbQBhAGwAZgBvAHIAbQBlAGQAIABqAHUAbgBjAHQAaQBvAG4AIAB0AGEAcgBnAGUAdAAACVwAPwA/AFwAAGtSAFUATgBUAEkATQBFAF8ASQBEAEUA
TgBUAEkAVABZAF8ASQBOAFYAQQBMAEkARAA6ACAAdQBuAHMAdQBwAHAAbwByAHQAZQBkACAAagB1AG4AYwB0AGkAbwBuACAAdABhAHIAZwBlAHQAAGdSAFUA
TgBUAEkATQBFAF8ASQBEAEUATgBUAEkAVABZAF8ASQBOAFYAQQBMAEkARAA6ACAAYQBtAGIAaQBnAHUAbwB1AHMAIABqAHUAbgBjAHQAaQBvAG4AIAB0AGEA
cgBnAGUAdAAAdVIAVQBOAFQASQBNAEUAXwBJAEQARQBOAFQASQBUAFkAXwBJAE4AVgBBAEwASQBEADoAIABpAG4AdgBhAGwAaQBkACAAcwBuAGEAcABzAGgA
bwB0ACAAagB1AG4AYwB0AGkAbwBuACAAdABhAHIAZwBlAHQAAD1GAFMAQwBUAEwAXwBTAEUAVABfAFIARQBQAEEAUgBTAEUAXwBQAE8ASQBOAFQAIABmAGEA
aQBsAGUAZAAAWVAAQQBUAEgAXwBPAFAARQBSAEEAVABJAE8ATgBfAEYAQQBJAEwARQBEADoAIABqAHUAbgBjAHQAaQBvAG4AIAB2AGUAcgBpAGYAaQBjAGEA
dABpAG8AbgAAM0MAcgBlAGEAdABlAEQAaQByAGUAYwB0AG8AcgB5AFcAIABmAGEAaQBsAGUAZAA6ACAAAENHAGUAdABGAGkAbABlAEkAbgBmAG8AcgBtAGEA
dABpAG8AbgBCAHkASABhAG4AZABsAGUAIABmAGEAaQBsAGUAZAAAQUcAZQB0AEYAaQBuAGEAbABQAGEAdABoAE4AYQBtAGUAQgB5AEgAYQBuAGQAbABlAFcA
IABmAGEAaQBsAGUAZAAABVgAOAAAIVcAcgBpAHQAZQBGAGkAbABlACAAZgBhAGkAbABlAGQAAC9GAGwAdQBzAGgARgBpAGwAZQBCAHUAZgBmAGUAcgBzACAA
ZgBhAGkAbABlAGQAAENQAGkAbgBuAGUAZAAgAGYAaQBsAGUAIABsAGUAbgBnAHQAaAAgAGkAcwAgAHUAbgBzAHUAcABwAG8AcgB0AGUAZAAAL1MAZQB0AEYA
aQBsAGUAUABvAGkAbgB0AGUAcgBFAHgAIABmAGEAaQBsAGUAZAAALUQAdQBwAGwAaQBjAGEAdABlAEgAYQBuAGQAbABlACAAZgBhAGkAbABlAGQAAAMtAAEB
AB9HAGUAdABQAHIAbwBjAGUAcwBzAFQAaQBtAGUAcwAANVEAdQBlAHIAeQBGAHUAbABsAFAAcgBvAGMAZQBzAHMASQBtAGEAZwBlAE4AYQBtAGUAVwAAD2UA
bgB0AHIAaQBlAHMAADNpAG4AdgBhAGwAaQBkACAAZQBuAHYAaQByAG8AbgBtAGUAbgB0ACAAZQBuAHQAcgB5AAAvUwBlAHQASQBuAGYAbwByAG0AYQB0AGkA
bwBuAEoAbwBiAE8AYgBqAGUAYwB0AAAvUABSAE8AQwBFAFMAUwBfAEYAQQBVAEwAVABfAEkATgBKAEUAQwBUAEUARAA6AAArcAByAG8AYwBlAHMAcwAgAGkA
bgBwAHUAdAAgAG0AaQBzAHMAaQBuAGcAACFDAHIAZQBhAHQAZQBKAG8AYgBPAGIAagBlAGMAdABXAAATagBvAGIAXwBzAGUAdAB1AHAAAC1DAHIAZQBhAHQA
ZQBJAG8AQwBvAG0AcABsAGUAdABpAG8AbgBQAG8AcgB0AAAnagBvAGIAXwBjAG8AbQBwAGwAZQB0AGkAbwBuAF8AcABvAHIAdAAAI0MAcgBlAGEAdABlAFAA
aQBwAGUAOgBzAHQAZABvAHUAdAAAN1MAZQB0AEgAYQBuAGQAbABlAEkAbgBmAG8AcgBtAGEAdABpAG8AbgA6AHMAdABkAG8AdQB0AAAjQwByAGUAYQB0AGUA
UABpAHAAZQA6AHMAdABkAGUAcgByAAA3UwBlAHQASABhAG4AZABsAGUASQBuAGYAbwByAG0AYQB0AGkAbwBuADoAcwB0AGQAZQByAHIAACFDAHIAZQBhAHQA
ZQBQAGkAcABlADoAcwB0AGQAaQBuAAA1UwBlAHQASABhAG4AZABsAGUASQBuAGYAbwByAG0AYQB0AGkAbwBuADoAcwB0AGQAaQBuAAAdQwByAGUAYQB0AGUA
UAByAG8AYwBlAHMAcwBXAAAZcABpAGQAXwBpAGQAZQBuAHQAaQB0AHkAADFBAHMAcwBpAGcAbgBQAHIAbwBjAGUAcwBzAFQAbwBKAG8AYgBPAGIAagBlAGMA
dAAAFWoAbwBiAF8AYQBzAHMAaQBnAG4AABlSAGUAcwB1AG0AZQBUAGgAcgBlAGEAZAAAQ0YAbwB1AG4AZABhAHQAaQBvAG4AVgBhAGwAaQBkAGEAdABpAG8A
bgBKAG8AYgBDAG8AbQBwAGwAZQB0AGkAbwBuAAAzRwBlAHQAUQB1AGUAdQBlAGQAQwBvAG0AcABsAGUAdABpAG8AbgBTAHQAYQB0AHUAcwAAF24AZQB3AF8A
cAByAG8AYwBlAHMAcwAAGWUAeABpAHQAXwBwAHIAbwBjAGUAcwBzAAArYQBiAG4AbwByAG0AYQBsAF8AZQB4AGkAdABfAHAAcgBvAGMAZQBzAHMAABdPAHAA
ZQBuAFAAcgBvAGMAZQBzAHMAADNRAHUAZQByAHkASQBuAGYAbwByAG0AYQB0AGkAbwBuAEoAbwBiAE8AYgBqAGUAYwB0AAAndABpAG0AZQBvAHUAdABNAGkA
bABsAGkAcwBlAGMAbwBuAGQAcwAAJUcAZQB0AEUAeABpAHQAQwBvAGQAZQBQAHIAbwBjAGUAcwBzAAAvcAByAG8AYwBlAHMAcwAgAGkAcwAgAHMAdABpAGwA
bAAgAGEAYwB0AGkAdgBlAAAAAADllQ7qf13fS6/Cfi4p/DNpAAi3elxWGTTgiQMgAA4EIAEBDgMgAAkEIAEBCQMgAAoEIAEBCgQgABERBSABARERAyAAAQIG
DgIGCQIGCgMGEREDKAAOAygACQMoAAoEKAAREQUgAB0SDAYgAQEdEgwDIAACBCABAQIEBh0SDAIGAgUoAB0SDAMoAAIEAAAAgAQAAABABAAAAQAEgAAAAAQg
AAAABAEAAAAEAgAAAAQDAAAABAAAAAIEAAAgAAQABAAABBAAAAAEAwAAoASoAAkABKQACQACBggEEgAAAAQEAAAABAoAAAAECwAAAAQAAAAACwAHEhUOCQkY
CQkYBQACAg4YCAACAhIVEBEcCgAEAhIVCBARIAkIAAQCEhUIGAkJAAQCEhUIHQUJCQAECRIVEhkJCQsABQISFR0FCRAJGAUAAQISFQ8ACAISFQkdBQkdBQkQ
CRgJAAQCEhUKEAoJDQAHAhgSFRgQEhUJAgkDAAAYBQABEh0OBAABDg4IAAMSFQ4CEAgFAAESFQ4HAAISFQ4QCAcAAhIQEhUCBQABARIVCAADARIVEhUOBQAB
DhIVBgACARIVDgQAAQEOBgABEggSFQcAAgESFR0FBgABHQUSFQYAARIVEhUDBhEYAgYcAwYSGQQgABIhBSABARIhBSABARIlBiABEiESJQgAAwISJBIkCAMG
EiEEKAASIQMgAAgEIAEBCAMoAAgEIAASLAUgAQESLAUgAB0SKAYgAQEdEigDBhIsBAYdEigEKAASLAUoAB0SKAQAAAAIBAABAAAEABAAAAQAABAABAAgAAAE
BwAAAAQJAAAABAYAAAAECAAAAAQCAQAABAMBAAALAAQCEBgQGBAROAkGAAMCGAkJCgAHGA4JCRgJCRgSAAoCDhIZGBgCCRgOEBE8EBFABQACGBgOBwAEAhgI
GAkJAAUCGAgYCRAJBQACAhgYBQACAhgJBwAEGBgYGQkLAAUCGBAJEBkQGAkHAAQCGAkZGAQAAQkYBQACCRgJBgACAhgQCRAABQIYEBFEEBFEEBFEEBFECQAE
AhgJEhkQCQYAAxgJAgkEAAECGAgGFRIpAggSKAIGGAMGEhUDBhItBAYfMQIEIAASJQUAAQoRRAQAAQoYBAABDhgFAAEOHQ4IEAEDARgIHgAQAAUBFRI1BQ4I
Cg4CDggKDgkABBI0Dg4OHQ4SAAUSNA4ODh0OFRI1BQ4ICg4CBiADAQgOAgQgAQIIBCAAEjADBhIlBCgAEiUCBgYCBgsCBhkDBhFMAwYRSAUgAQERPQECAwAA
CAUgAgEIDgQAAQIOBCABAwgFAAIODg4FBwIJEhUEBwESFQYVEmkBEgwGAAIJHQUIBAAAEnUHIAMOHQUICAUAAgIODgUgAQETAAUgAB0TABcHDBUSaQESDB0F
CAgSEAgJCQkOEgwSEAYAARJ5EX0FAAEIEnkGBwIRIBEgByACAg4RgIEDBhFgCQACARKAjRGAkQUgAQgdAwQAAQIDBCABDggFIAEOHQMGAAMODg4OBSABHQUO
BAABGAgGAAMBGAgFBgADARgICAUgAQEQAgYAAwEYCBgFAAIYGAgIAAQBHQUIGAgEAAEBGBYHEQMSCA4OHQUICAgIGAIIAggOCB0DBgACBx0FCAQgAQgDDgcL
HQUJCAgICAgIDg4OBQABHQUJDAAFARKAjQgSgI0ICAUAAR0FBw4HCA4OHQUdBQgdBQkSCAQgAQ4OBQABEREKCwcGERwSGQkKChIIBQACCgoKBwcECQkdBQkK
IAQBEhURgKkIAgYgAQESgLEEIAAdBRIHCBIIChIVGBKApRKArR0FEhUFBwISFRgFAAASgLUHIAEdBRKAsQUAAQ4dBQUgAg4ODg8HBwoSFRgSgKUSgLUOEhUG
IAEBEYDBBiABARKAyQQGEYDNAwYSJAMGHQMHBhURgNUBCAwgAxUSgNkBCB0DCAgGFRKA2QEICiABFRGA0QETAAIGFRGA0QEICSAAFRGA1QETAAYVEYDVAQgK
MAICARAeABAeAQoKAhURgNUBCBFkBCAAEwAGAAIBHBACCCADEhkdAwgIBAABARwGIAEBEoDhHwcKEoDhAhKA4QgIFRGA0QEIFRGA1QEIFRGA1QEICBwFIAEB
Enk3AQAyRm91bmRhdGlvblZhbGlkYXRpb25Bc3luY1N0cmVhbUNhcHR1cmUrPERyYWluPmRfXzEAAAUAABGAzQcwAQEBEB4ABAoBEWQHBwIRZBGAzQUHAwIO
HAcAAgIdEiEIBgcCAh0SIQcVEikCCBIoCgcEEUQRRBFEEUQFBwISGQkFIAESGQ4FIAESGQMGBwMSGQgOAh4ACBABAwEeABgCBAoBHgAEBwIIGAkVEjUFDggK
DgIMIAQTBBMAEwETAhMDBAoBEVAECgERVAUgAgEYAgQAARgOBSACAQICCiAEARKAsRJ1AggcBxISNBgYGBgYGBFAAhFQEVQROBgYETwSGQkSNAUgAgEcGAYg
AQESgQURBw0JGRgCCAIIAhKA4QIcHBwIIAICEwAQEwEHIAIBEwATARYHDxIoGAoOCg4SFRIIAhKA4QICHBwcBgACHBgSeQsHBggYCRFYEiwSLAMHAQkEAAAR
EQUgARERDQcAAgIRERERBAABAQgKBwURERIsAhERHAcAAggSKBIoCAYVEoENARIoBCABCAgDBwEICyAAFRGBEQITABMBCBURgRECCBIoCyAAFRGBFQITABMB
CBURgRUCCBIoBCAAEwEHFRKBDQESKA4QAQIBHR4AFRKBDQEeAAQKARIoHgcJEjAdEigIFRGBFQIIEigSKBIoAhwVEYERAggSKAQHARIsCAEACAAAAAAAHgEA
AQBUAhZXcmFwTm9uRXhjZXB0aW9uVGhyb3dzAXSiAAAAAAAAAAAAAI6iAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAogAAAAAAAAAAAAAAAF9Db3JEbGxN
YWluAG1zY29yZWUuZGxsAAAAAAD/JQAgABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAEAAAABgAAIAAAAAAAAAAAAAAAAAAAAEAAQAAADAAAIAAAAAAAAAAAAAAAAAAAAEAAAAAAEgAAABYwAAA
nAIAAAAAAAAAAAAAnAI0AAAAVgBTAF8AVgBFAFIAUwBJAE8ATgBfAEkATgBGAE8AAAAAAL0E7/4AAAEAAAAAAAAAAAAAAAAAAAAAAD8AAAAAAAAABAAAAAIA
AAAAAAAAAAAAAAAAAABEAAAAAQBWAGEAcgBGAGkAbABlAEkAbgBmAG8AAAAAACQABAAAAFQAcgBhAG4AcwBsAGEAdABpAG8AbgAAAAAAAACwBPwBAAABAFMA
dAByAGkAbgBnAEYAaQBsAGUASQBuAGYAbwAAANgBAAABADAAMAAwADAAMAA0AGIAMAAAACwAAgABAEYAaQBsAGUARABlAHMAYwByAGkAcAB0AGkAbwBuAAAA
AAAgAAAAMAAIAAEARgBpAGwAZQBWAGUAcgBzAGkAbwBuAAAAAAAwAC4AMAAuADAALgAwAAAAZAAiAAEASQBuAHQAZQByAG4AYQBsAE4AYQBtAGUAAABGAG8A
dQBuAGQAYQB0AGkAbwBuAFYAYQBsAGkAZABhAHQAaQBvAG4ALgBFAG0AYgBlAGQAZABlAGQALgBkAGwAbAAAACgAAgABAEwAZQBnAGEAbABDAG8AcAB5AHIA
aQBnAGgAdAAAACAAAABsACIAAQBPAHIAaQBnAGkAbgBhAGwARgBpAGwAZQBuAGEAbQBlAAAARgBvAHUAbgBkAGEAdABpAG8AbgBWAGEAbABpAGQAYQB0AGkA
bwBuAC4ARQBtAGIAZQBkAGQAZQBkAC4AZABsAGwAAAA0AAgAAQBQAHIAbwBkAHUAYwB0AFYAZQByAHMAaQBvAG4AAAAwAC4AMAAuADAALgAwAAAAOAAIAAEA
QQBzAHMAZQBtAGIAbAB5ACAAVgBlAHIAcwBpAG8AbgAAADAALgAwAC4AMAAuADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKAAAAwAAACgMgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAA=
'@

function Get-FoundationEmbeddedNativeCompilationSource {
    $nativeSource = [string](Get-FoundationNativePathSource)
    $asyncSourceLines = @(([string](Get-FoundationAsyncStreamCaptureSource)) -split "`r?`n")
    if ($asyncSourceLines.Count -lt 6 -or
        [string]$asyncSourceLines[0] -cne "using System;" -or
        [string]$asyncSourceLines[1] -cne "using System.IO;" -or
        [string]$asyncSourceLines[2] -cne "using System.Text;" -or
        [string]$asyncSourceLines[3] -cne "using System.Threading.Tasks;" -or
        -not [string]::IsNullOrEmpty([string]$asyncSourceLines[4])) {
        throw "NATIVE_BOOTSTRAP_INVALID:source_shape"
    }
    $nativeCrlf = $nativeSource.Replace("`r`n", "`n").Replace("`r", "`n").Replace("`n", "`r`n")
    $asyncBody = [string]::Join("`r`n", [string[]]@($asyncSourceLines | Select-Object -Skip 5))
    $processBody = ([string](Get-FoundationNativeProcessSource)).Replace("`r`n", "`n").Replace("`r", "`n").Replace("`n", "`r`n")
    return "using System.Text;`r`nusing System.Threading;`r`nusing System.Threading.Tasks;`r`nusing System.Collections.Generic;`r`n" + $nativeCrlf + "`r`n" + $asyncBody + "`r`n" + $processBody
}

function Get-FoundationEmbeddedNativeContractText {
    param([Parameter(Mandatory = $true)][Reflection.Assembly]$Assembly)
    $lines = New-Object System.Collections.ArrayList
    [void]$lines.Add("ASSEMBLY|$($Assembly.FullName)|MVID=$($Assembly.ManifestModule.ModuleVersionId.ToString('D').ToUpperInvariant())|IMAGE=$($Assembly.ImageRuntimeVersion)|ARCH=$($Assembly.GetName().ProcessorArchitecture)")
    [string[]]$references = @($Assembly.GetReferencedAssemblies() | ForEach-Object { $_.FullName })
    [Array]::Sort($references, [StringComparer]::Ordinal)
    [void]$lines.Add("REFERENCES|" + [string]::Join(";", [string[]]$references))
    [string[]]$exportedTypes = @($Assembly.GetExportedTypes() | ForEach-Object { $_.FullName })
    [Array]::Sort($exportedTypes, [StringComparer]::Ordinal)
    [void]$lines.Add("EXPORTED|" + [string]::Join(";", [string[]]$exportedTypes))
    $typeNames = @(
        "FoundationNativePathInfo",
        "FoundationNativeDirectoryEntry",
        "FoundationNativeDirectoryBatch",
        "FoundationValidationNativePath",
        "FoundationValidationAsyncStreamCapture",
        "FoundationNativeCompletionMessage",
        "FoundationNativeJobAccounting",
        "FoundationNativeJobSnapshot",
        "FoundationValidationNativeProcessSession"
    )
    foreach ($typeName in $typeNames) {
        $type = $Assembly.GetType($typeName, $false, $false)
        if ($null -eq $type) {
            [void]$lines.Add("MISSING|$typeName")
            continue
        }
        [void]$lines.Add("TYPE|$($type.FullName)|PUBLIC=$($type.IsPublic)|SEALED=$($type.IsSealed)|ABSTRACT=$($type.IsAbstract)|BASE=$($type.BaseType.FullName)")
        [string[]]$constructors = @($type.GetConstructors([Reflection.BindingFlags]"Public,Instance,DeclaredOnly") | ForEach-Object {
            $parameters = @($_.GetParameters() | ForEach-Object { $_.ParameterType.FullName }) -join ","
            "CTOR|$parameters"
        })
        [Array]::Sort($constructors, [StringComparer]::Ordinal)
        foreach ($line in $constructors) { [void]$lines.Add($line) }
        [string[]]$properties = @($type.GetProperties([Reflection.BindingFlags]"Public,Instance,Static,DeclaredOnly") | ForEach-Object {
            $getter = $_.GetGetMethod($true)
            $setter = $_.GetSetMethod($true)
            $getPublic = $null -ne $getter -and $getter.IsPublic
            $setPublic = $null -ne $setter -and $setter.IsPublic
            $setPrivate = $null -ne $setter -and $setter.IsPrivate
            $isStatic = $null -ne $getter -and $getter.IsStatic
            "PROPERTY|$($_.PropertyType.FullName)|$($_.Name)|GET_PUBLIC=$getPublic|SET_PUBLIC=$setPublic|SET_PRIVATE=$setPrivate|STATIC=$isStatic"
        })
        [Array]::Sort($properties, [StringComparer]::Ordinal)
        foreach ($line in $properties) { [void]$lines.Add($line) }
        [string[]]$fields = @($type.GetFields([Reflection.BindingFlags]"Public,Static,DeclaredOnly") | ForEach-Object {
            $value = $_.GetRawConstantValue()
            if ($value -is [IFormattable]) { $valueText = $value.ToString($null, [Globalization.CultureInfo]::InvariantCulture) }
            else { $valueText = [string]$value }
            "FIELD|$($_.FieldType.FullName)|$($_.Name)|LITERAL=$($_.IsLiteral)|INITONLY=$($_.IsInitOnly)|VALUE=$valueText"
        })
        [Array]::Sort($fields, [StringComparer]::Ordinal)
        foreach ($line in $fields) { [void]$lines.Add($line) }
        [string[]]$methods = @($type.GetMethods([Reflection.BindingFlags]"Public,Instance,Static,DeclaredOnly") | Where-Object { -not $_.IsSpecialName } | ForEach-Object {
            $parameters = @($_.GetParameters() | ForEach-Object { $_.ParameterType.FullName }) -join ","
            "METHOD|$($_.ReturnType.FullName)|$($_.Name)|$parameters|STATIC=$($_.IsStatic)"
        })
        [Array]::Sort($methods, [StringComparer]::Ordinal)
        foreach ($line in $methods) { [void]$lines.Add($line) }
    }
    return [string]::Join("`n", [string[]]$lines)
}

function Assert-FoundationEmbeddedNativeAssemblyContract {
    param([Parameter(Mandatory = $true)][Reflection.Assembly]$Assembly)
    if ([string]$Assembly.FullName -cne $script:FoundationEmbeddedNativeAssemblyFullName -or
        $Assembly.ManifestModule.ModuleVersionId.ToString("D").ToUpperInvariant() -cne $script:FoundationEmbeddedNativeAssemblyMvid -or
        -not [string]::IsNullOrEmpty([string]$Assembly.Location)) {
        throw "NATIVE_BOOTSTRAP_INVALID:assembly_identity"
    }
    $contractText = Get-FoundationEmbeddedNativeContractText -Assembly $Assembly
    if ((Get-FoundationSha256Text $contractText) -cne $script:FoundationEmbeddedNativeContractSha256) {
        throw "NATIVE_BOOTSTRAP_INVALID:contract"
    }
}

function Get-FoundationEmbeddedNativeLoadedAssembly {
    $typeNames = @(
        "FoundationNativePathInfo",
        "FoundationNativeDirectoryEntry",
        "FoundationNativeDirectoryBatch",
        "FoundationValidationNativePath",
        "FoundationValidationAsyncStreamCapture",
        "FoundationNativeCompletionMessage",
        "FoundationNativeJobAccounting",
        "FoundationNativeJobSnapshot",
        "FoundationValidationNativeProcessSession"
    )
    $types = New-Object System.Collections.ArrayList
    foreach ($typeName in $typeNames) {
        $type = $typeName -as [type]
        if ($null -ne $type) { [void]$types.Add($type) }
    }
    if ($types.Count -eq 0) { return $null }
    if ($types.Count -ne $typeNames.Count) { throw "NATIVE_BOOTSTRAP_INVALID:type_set" }
    $assembly = $types[0].Assembly
    foreach ($type in @($types)) {
        if (-not [object]::ReferenceEquals($type.Assembly, $assembly)) {
            throw "NATIVE_BOOTSTRAP_INVALID:assembly_identity"
        }
    }
    return $assembly
}

function Initialize-FoundationEmbeddedNativeAssembly {
    if ($script:FoundationEmbeddedNativeAssemblyValidated) {
        $validatedAssembly = $script:FoundationEmbeddedNativeAssemblyObject
        if ($null -eq $validatedAssembly -or
            [string]$validatedAssembly.FullName -cne $script:FoundationEmbeddedNativeAssemblyFullName -or
            $validatedAssembly.ManifestModule.ModuleVersionId.ToString("D").ToUpperInvariant() -cne $script:FoundationEmbeddedNativeAssemblyMvid -or
            -not [string]::IsNullOrEmpty([string]$validatedAssembly.Location)) {
            throw "NATIVE_BOOTSTRAP_INVALID:validated_state"
        }
        return
    }
    $lock = [string]::Intern("FoundationValidation.Embedded/$($script:FoundationEmbeddedNativeAssemblySha256)")
    [Threading.Monitor]::Enter($lock)
    try {
        if ($script:FoundationEmbeddedNativeAssemblyValidated) {
            $validatedAssembly = $script:FoundationEmbeddedNativeAssemblyObject
            if ($null -eq $validatedAssembly -or
                [string]$validatedAssembly.FullName -cne $script:FoundationEmbeddedNativeAssemblyFullName -or
                $validatedAssembly.ManifestModule.ModuleVersionId.ToString("D").ToUpperInvariant() -cne $script:FoundationEmbeddedNativeAssemblyMvid -or
                -not [string]::IsNullOrEmpty([string]$validatedAssembly.Location)) {
                throw "NATIVE_BOOTSTRAP_INVALID:validated_state"
            }
            return
        }
        $loadedAssembly = Get-FoundationEmbeddedNativeLoadedAssembly
        if ((Get-FoundationSha256Text (Get-FoundationEmbeddedNativeCompilationSource)) -cne $script:FoundationEmbeddedNativeSourceSha256) {
            throw "NATIVE_BOOTSTRAP_INVALID:source_sha256"
        }
        if ($null -eq $loadedAssembly) {
            try { [byte[]]$assemblyBytes = [Convert]::FromBase64String($script:FoundationEmbeddedNativeAssemblyBase64) }
            catch { throw "NATIVE_BOOTSTRAP_INVALID:base64" }
            if ($assemblyBytes.Length -ne $script:FoundationEmbeddedNativeAssemblyLength) {
                throw "NATIVE_BOOTSTRAP_INVALID:length"
            }
            if ((Get-FoundationSha256Bytes $assemblyBytes) -cne $script:FoundationEmbeddedNativeAssemblySha256) {
                throw "NATIVE_BOOTSTRAP_INVALID:sha256"
            }
            try { $loadedAssembly = [Reflection.Assembly]::Load($assemblyBytes) }
            catch { throw "NATIVE_BOOTSTRAP_INVALID:load:$($_.Exception.GetType().FullName)" }
        }
        Assert-FoundationEmbeddedNativeAssemblyContract -Assembly $loadedAssembly
        $resolvedAssembly = Get-FoundationEmbeddedNativeLoadedAssembly
        if ($null -eq $resolvedAssembly -or -not [object]::ReferenceEquals($resolvedAssembly, $loadedAssembly)) {
            throw "NATIVE_BOOTSTRAP_INVALID:type_resolution"
        }
        $script:FoundationEmbeddedNativeAssemblyObject = $loadedAssembly
        $script:FoundationEmbeddedNativeAssemblyValidated = $true
    }
    finally {
        [Threading.Monitor]::Exit($lock)
    }
}

function Initialize-FoundationNativePathType {
    Initialize-FoundationEmbeddedNativeAssembly
}

function Initialize-FoundationAsyncStreamCaptureType {
    Initialize-FoundationEmbeddedNativeAssembly
}


function New-FoundationEmptyTaskkillResult {
    return [pscustomobject]@{
        attempted = $false
        path = $null
        arguments = @()
        exit_code = $null
        timed_out = $false
        stdout = $null
        stderr = $null
        error_type = $null
        error_text = $null
    }
}

function ConvertTo-FoundationTaskkillResult {
    param($Value, $Request)
    if ($null -eq $Value) {
        return [pscustomobject]@{ attempted = $true; path = [string]$Request.path; arguments = @($Request.arguments); exit_code = $null; timed_out = $true; stdout = ""; stderr = ""; error_type = "System.TimeoutException"; error_text = "taskkill timeout after 5000ms" }
    }
    return [pscustomobject]@{
        attempted = $true
        path = [string]$Request.path
        arguments = @($Request.arguments)
        exit_code = $Value.exit_code
        timed_out = [bool]$Value.timed_out
        stdout = [string]$Value.stdout
        stderr = [string]$Value.stderr
        error_type = $Value.error_type
        error_text = $Value.error_text
    }
}

function Invoke-FoundationTaskkill {
    param([int]$ProcessId, [int]$TimeoutMs = 5000)
    $arguments = @("/PID", [string]$ProcessId, "/T", "/F")
    $request = [pscustomobject]@{ path = "C:\Windows\System32\taskkill.exe"; arguments = @($arguments); timeout_ms = $TimeoutMs }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = [string]$request.path
    $psi.Arguments = (@($arguments | ForEach-Object { ConvertTo-FoundationWindowsArgument ([string]$_) }) -join " ")
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    $stdoutCapture = $null
    $stderrCapture = $null
    try {
        Initialize-FoundationAsyncStreamCaptureType
        [void]$process.Start()
        $stdoutCapture = New-Object FoundationValidationAsyncStreamCapture -ArgumentList $process.StandardOutput
        $stderrCapture = New-Object FoundationValidationAsyncStreamCapture -ArgumentList $process.StandardError
        $completed = $process.WaitForExit($TimeoutMs)
        if (-not $completed) {
            try { $process.Kill() } catch { }
            [void]$process.WaitForExit(250)
            [void][FoundationValidationAsyncStreamCapture]::WaitBoth($stdoutCapture, $stderrCapture, 250)
            return [pscustomobject]@{ attempted = $true; path = $psi.FileName; arguments = @($arguments); exit_code = $null; timed_out = $true; stdout = $stdoutCapture.Snapshot(); stderr = $stderrCapture.Snapshot(); error_type = "System.TimeoutException"; error_text = "taskkill timeout after ${TimeoutMs}ms" }
        }
        [void][FoundationValidationAsyncStreamCapture]::WaitBoth($stdoutCapture, $stderrCapture, 250)
        $exitCode = [int]$process.ExitCode
        $stderr = $stderrCapture.Snapshot()
        $errorType = $null
        $errorText = $null
        if ($exitCode -ne 0) {
            $errorType = "NativeCommandExitCode"
            $detail = if ([string]::IsNullOrWhiteSpace($stderr)) { "no stderr" } else { $stderr.Trim() }
            $errorText = "taskkill exit code $exitCode; $detail"
        }
        return [pscustomobject]@{ attempted = $true; path = $psi.FileName; arguments = @($arguments); exit_code = $exitCode; timed_out = $false; stdout = $stdoutCapture.Snapshot(); stderr = $stderr; error_type = $errorType; error_text = $errorText }
    }
    catch {
        return [pscustomobject]@{ attempted = $true; path = $psi.FileName; arguments = @($arguments); exit_code = $null; timed_out = $false; stdout = if ($null -eq $stdoutCapture) { "" } else { $stdoutCapture.Snapshot() }; stderr = if ($null -eq $stderrCapture) { "" } else { $stderrCapture.Snapshot() }; error_type = $_.Exception.GetType().FullName; error_text = $_.Exception.ToString() }
    }
    finally {
        $process.Dispose()
    }
}

function Copy-FoundationProcessPlainDtoMap {
    param([AllowNull()]$Value)
    $errorCode = "PROCESS_ENVIRONMENT_POLICY_INVALID"
    if ($null -eq $Value) { throw $errorCode }

    $names = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $map = New-Object System.Collections.Hashtable ([System.StringComparer]::OrdinalIgnoreCase)
    if ($Value -is [System.Management.Automation.PSCustomObject]) {
        $properties = @($Value.PSObject.Properties)
        foreach ($property in $properties) {
            if ($property.MemberType -ne [System.Management.Automation.PSMemberTypes]::NoteProperty -or
                [string]::IsNullOrWhiteSpace([string]$property.Name) -or
                -not $names.Add([string]$property.Name)) {
                throw $errorCode
            }
        }
        foreach ($property in $properties) {
            [void]$map.Add([string]$property.Name, $property.Value)
        }
        return $map
    }

    $valueType = [System.Object].GetMethod("GetType").Invoke($Value, $null)
    if ($valueType -eq [System.Collections.Hashtable] -or $valueType -eq [System.Collections.Specialized.OrderedDictionary]) {
        foreach ($property in @($Value.PSObject.Properties)) {
            if ($property.MemberType -ne [System.Management.Automation.PSMemberTypes]::Property) { throw $errorCode }
        }
        $dictionaryKeysProperty = [System.Collections.IDictionary].GetProperty("Keys")
        $dictionaryItemProperty = [System.Collections.IDictionary].GetProperty("Item")
        $keys = @($dictionaryKeysProperty.GetValue($Value, $null))
        foreach ($key in $keys) {
            if (-not ($key -is [string]) -or [string]::IsNullOrWhiteSpace([string]$key) -or -not $names.Add([string]$key)) {
                throw $errorCode
            }
        }
        foreach ($key in $keys) {
            [void]$map.Add([string]$key, $dictionaryItemProperty.GetValue($Value, @([object]$key)))
        }
        return $map
    }
    throw $errorCode
}

function Assert-FoundationProcessPlainDtoShape {
    param(
        [Parameter(Mandatory = $true)][System.Collections.Hashtable]$Map,
        [Parameter(Mandatory = $true)][string[]]$Expected
    )
    $errorCode = "PROCESS_ENVIRONMENT_POLICY_INVALID"
    if ($Map.Count -ne $Expected.Count) { throw $errorCode }
    foreach ($name in $Expected) {
        if (-not $Map.ContainsKey($name)) { throw $errorCode }
    }
}

function Copy-FoundationProcessPlainCollection {
    param([AllowNull()]$Value)
    $errorCode = "PROCESS_ENVIRONMENT_POLICY_INVALID"
    if ($null -eq $Value) { throw $errorCode }
    $items = New-Object System.Collections.ArrayList
    if ($Value -is [System.Array]) {
        if ($Value.Rank -ne 1) { throw $errorCode }
        $lower = $Value.GetLowerBound(0)
        $upper = $Value.GetUpperBound(0)
        for ($index = $lower; $index -le $upper; $index++) {
            [void]$items.Add($Value.GetValue($index))
        }
        return @($items)
    }
    $valueType = [System.Object].GetMethod("GetType").Invoke($Value, $null)
    if ($valueType -eq [System.Collections.ArrayList]) {
        for ($index = 0; $index -lt $Value.Count; $index++) {
            [void]$items.Add($Value[$index])
        }
        return @($items)
    }
    throw $errorCode
}

function Copy-FoundationProcessEnvironmentEntries {
    param([AllowNull()]$Policy)
    $errorCode = "PROCESS_ENVIRONMENT_POLICY_INVALID"
    $policyMap = Copy-FoundationProcessPlainDtoMap $Policy

    $hasFlatEntries = $policyMap.ContainsKey("exact_key_values")
    $hasNestedEntries = $policyMap.ContainsKey("parent_environment")
    if ($hasFlatEntries -eq $hasNestedEntries) { throw $errorCode }

    if (-not $policyMap.ContainsKey("inherit_environment")) { throw $errorCode }
    $inheritEnvironment = $policyMap["inherit_environment"]
    if (-not ($inheritEnvironment -is [bool]) -or [bool]$inheritEnvironment) { throw $errorCode }

    $rawEntries = $null
    if ($hasNestedEntries) {
        Assert-FoundationProcessPlainDtoShape $policyMap @("inherit_environment", "profile", "parent_environment", "derived_child_environment")

        $profileMap = Copy-FoundationProcessPlainDtoMap $policyMap["profile"]
        Assert-FoundationProcessPlainDtoShape $profileMap @("root", "home", "appdata", "localappdata", "temp")
        foreach ($name in @("root", "home", "appdata", "localappdata", "temp")) {
            $value = $profileMap[$name]
            if (-not ($value -is [string]) -or [string]::IsNullOrWhiteSpace([string]$value)) { throw $errorCode }
        }

        $parentEnvironmentMap = Copy-FoundationProcessPlainDtoMap $policyMap["parent_environment"]
        Assert-FoundationProcessPlainDtoShape $parentEnvironmentMap @("exact_key_values")
        $rawEntries = $parentEnvironmentMap["exact_key_values"]

        $derivedEnvironmentMap = Copy-FoundationProcessPlainDtoMap $policyMap["derived_child_environment"]
        Assert-FoundationProcessPlainDtoShape $derivedEnvironmentMap @("authority", "caller_values_allowed", "incoming_request_env", "q_supplied_env", "source_derived_createprocess_env", "bootstrap_visible_env", "observations")
        $authority = $derivedEnvironmentMap["authority"]
        $callerValuesAllowed = $derivedEnvironmentMap["caller_values_allowed"]
        if (-not ($authority -is [string]) -or [string]$authority -cne "policy_module" -or
            -not ($callerValuesAllowed -is [bool]) -or [bool]$callerValuesAllowed) {
            throw $errorCode
        }
        foreach ($name in @("incoming_request_env", "q_supplied_env", "source_derived_createprocess_env", "bootstrap_visible_env")) {
            if ($null -ne $derivedEnvironmentMap[$name]) { throw $errorCode }
        }
        $observationValues = @(Copy-FoundationProcessPlainCollection $derivedEnvironmentMap["observations"])
        if ($observationValues.Count -ne 0) { throw $errorCode }
    }
    else {
        Assert-FoundationProcessPlainDtoShape $policyMap @("inherit_environment", "exact_key_values")
        $rawEntries = $policyMap["exact_key_values"]
    }

    $entryValues = @(Copy-FoundationProcessPlainCollection $rawEntries)
    if ($entryValues.Count -eq 0) { throw $errorCode }

    $unique = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $entries = New-Object System.Collections.ArrayList
    foreach ($entry in $entryValues) {
        $entryMap = Copy-FoundationProcessPlainDtoMap $entry
        Assert-FoundationProcessPlainDtoShape $entryMap @("name", "value", "source")
        $name = $entryMap["name"]
        $value = $entryMap["value"]
        $source = $entryMap["source"]
        if (-not ($name -is [string]) -or [string]::IsNullOrWhiteSpace([string]$name) -or
            ([string]$name).IndexOf("=") -ge 0 -or ([string]$name).IndexOf([char]0) -ge 0 -or
            -not ($value -is [string]) -or ([string]$value).IndexOf([char]0) -ge 0 -or
            -not ($source -is [string]) -or [string]::IsNullOrWhiteSpace([string]$source) -or ([string]$source).IndexOf([char]0) -ge 0 -or
            -not $unique.Add([string]$name)) {
            throw $errorCode
        }
        [void]$entries.Add([pscustomobject][ordered]@{
            name = [string]$name
            value = [string]$value
            source = [string]$source
        })
    }
    return @($entries)
}

function Get-FoundationNativeProcessIdentity {
    param([Parameter(Mandatory = $true)]$Session)
    Initialize-FoundationNativePathType
    $path = ConvertTo-FoundationStrictLocalPath ([string]$Session.ExecutablePath)
    $pins = New-FoundationPinnedPathChain -Path $path -ShareWrite $false -AllowMissing $false
    $handle = $null
    try {
        $handle = [FoundationValidationNativePath]::OpenImmutableRead($path)
        $info = [FoundationValidationNativePath]::GetInfo($handle)
        $finalPath = ConvertFrom-FoundationFinalHandlePath ([string]$info.FinalPath)
        if (-not $finalPath.Equals($path, [System.StringComparison]::OrdinalIgnoreCase) -or
            ($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0 -or
            ($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0 -or
            [int]$Session.Id -le 0 -or [long]$Session.StartTimeFileTimeUtc -le 0) {
            throw "PROCESS_PID_IDENTITY_MISMATCH:$path"
        }
        return [pscustomobject][ordered]@{
            pid = [int]$Session.Id
            start_time_filetime_utc = [long]$Session.StartTimeFileTimeUtc
            executable_path = $path
            length = [long]$info.Length
            sha256 = [FoundationValidationNativePath]::Sha256($handle)
        }
    }
    finally {
        if ($null -ne $handle) { $handle.Dispose() }
        Close-FoundationPinSet $pins
    }
}

function Get-FoundationNativeJobControl {
    param(
        [Parameter(Mandatory = $true)]$Session,
        [Parameter(Mandatory = $true)]$ProcessIdentity,
        [Parameter(Mandatory = $true)]$CommandSpec,
        [Parameter(Mandatory = $true)][bool]$EvidencePending
    )
    Start-Sleep -Milliseconds 50
    $snapshot = $Session.GetJobSnapshot()
    $messages = New-Object System.Collections.ArrayList
    $identityFailures = New-Object System.Collections.ArrayList
    $pidSet = New-Object 'System.Collections.Generic.HashSet[int]'
    [void]$pidSet.Add([int]$ProcessIdentity.pid)
    foreach ($native in @($snapshot.Messages)) {
        [void]$pidSet.Add([int]$native.ProcessId)
        if (-not [string]::IsNullOrWhiteSpace([string]$native.IdentityError)) {
            [void]$identityFailures.Add([pscustomobject][ordered]@{ pid = [int]$native.ProcessId; error_text = [string]$native.IdentityError })
        }
        $isParent = [int]$native.ProcessId -eq [int]$ProcessIdentity.pid
        $role = if ([string]$CommandSpec.route -ceq "TEST") { "test_fixture" } elseif ($isParent) { "direct_parent" } else { "unexpected" }
        [void]$messages.Add([pscustomobject][ordered]@{
            pid = [int]$native.ProcessId
            start_time_filetime_utc = if ([long]$native.StartTimeFileTimeUtc -gt 0) { [long]$native.StartTimeFileTimeUtc } else { $null }
            executable_path = if ([string]::IsNullOrWhiteSpace([string]$native.ExecutablePath)) { $null } else { [string]$native.ExecutablePath }
            length = if ([long]$native.Length -gt 0) { [long]$native.Length } else { $null }
            sha256 = if ([string]::IsNullOrWhiteSpace([string]$native.Sha256)) { $null } else { [string]$native.Sha256 }
            snapshot_manifest_match = if ($isParent) { $true } else { $null }
            role = $role
            spawn_journal_id = $null
            first_event = [string]$native.FirstEvent
            last_event = [string]$native.LastEvent
            exit_observed = [bool]$native.ExitObserved
        })
    }
    [int[]]$uniquePids = @($pidSet)
    [Array]::Sort($uniquePids)
    $active = [int]$snapshot.Accounting.ActiveProcesses
    $total = [int]$snapshot.Accounting.TotalProcesses
    $completionHealthy = [string]::IsNullOrWhiteSpace([string]$snapshot.CompletionError) -and $identityFailures.Count -eq 0
    $expectedTotal = if ($EvidencePending) { $null } else { 1 }
    $accountingMatched = if ($EvidencePending) { $false } else { $active -eq 0 -and $total -eq 1 -and $pidSet.Count -eq 1 -and $completionHealthy }
    return [pscustomobject][ordered]@{
        completion_telemetry = [pscustomobject][ordered]@{
            best_effort = $true
            messages = @($messages)
            unique_new_pids = @($uniquePids)
            identity_failures = @($identityFailures)
            active_zero_observed = [bool]$snapshot.ActiveZeroObserved
        }
        accounting = [pscustomobject][ordered]@{
            total_processes = $total
            active_processes = $active
            expected_total_processes = $expectedTotal
            matched = $accountingMatched
        }
        spawn_journal = [pscustomobject][ordered]@{ intents = @(); results = @(); matched = (-not $EvidencePending) }
    }
}

function New-FoundationProcessFaultState {
    param([AllowNull()][scriptblock]$ProcessFaultInjector)
    return [pscustomobject][ordered]@{
        active = [bool]($null -ne $ProcessFaultInjector)
        phase = $null
        injected = $false
        error_type = $null
        error_text = $null
    }
}

function Get-FoundationProcessFaultErrorCode {
    param([AllowNull()][string]$Phase)
    switch ([string]$Phase) {
        "create_before_job" { return "PROCESS_START_FAILED" }
        "job_setup" { return "PROCESS_JOB_SETUP_FAILED" }
        "job_completion_port" { return "PROCESS_JOB_SETUP_FAILED" }
        "job_assign" { return "PROCESS_JOB_ASSIGNMENT_FAILED" }
        "pid_identity" { return "PROCESS_PID_IDENTITY_MISMATCH" }
        "job_completion_event" { return "PROCESS_COMPLETION_TELEMETRY_INCOMPLETE" }
        "job_accounting_query" { return "PROCESS_JOB_ACCOUNTING_MISMATCH" }
        default { return "PROCESS_RUNTIME_FAILED" }
    }
}

function New-FoundationProcessFaultIdentity {
    param([int]$ProcessId, [long]$StartTimeFileTimeUtc, [AllowNull()][string]$ExecutablePath)
    if ($ProcessId -le 0 -or $StartTimeFileTimeUtc -le 0 -or [string]::IsNullOrWhiteSpace($ExecutablePath)) { return $null }
    $path = ConvertTo-FoundationStrictLocalPath $ExecutablePath
    $pins = New-FoundationPinnedPathChain -Path $path -ShareWrite $false -AllowMissing $false
    $handle = $null
    try {
        $handle = [FoundationValidationNativePath]::OpenImmutableRead($path)
        $info = [FoundationValidationNativePath]::GetInfo($handle)
        $finalPath = ConvertFrom-FoundationFinalHandlePath ([string]$info.FinalPath)
        if (-not $finalPath.Equals($path, [System.StringComparison]::OrdinalIgnoreCase) -or
            ($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0 -or
            ($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0) {
            throw "PROCESS_PID_IDENTITY_MISMATCH:$path"
        }
        return [pscustomobject][ordered]@{
            pid = $ProcessId
            start_time_filetime_utc = $StartTimeFileTimeUtc
            executable_path = $path
            length = [long]$info.Length
            sha256 = [FoundationValidationNativePath]::Sha256($handle)
        }
    }
    finally {
        if ($null -ne $handle) { $handle.Dispose() }
        Close-FoundationPinSet $pins
    }
}

function Invoke-FoundationProcessFaultProbe {
    param(
        [AllowNull()][scriptblock]$ProcessFaultInjector,
        [Parameter(Mandatory = $true)]$FaultState,
        [Parameter(Mandatory = $true)][string]$Phase,
        [Parameter(Mandatory = $true)][string]$CommandId,
        [AllowNull()]$ProcessIdentity
    )
    $allowed = @("create_before_job", "job_setup", "job_completion_port", "job_assign", "pid_identity", "stream_stdout_fault", "stream_stderr_cancel", "job_completion_event", "job_accounting_query", "job_query", "job_close")
    if ($Phase -cnotin $allowed) { throw "PROCESS_FAULT_INJECTOR_INVALID:phase" }
    if ($null -eq $ProcessFaultInjector) { return $false }
    $request = [pscustomobject][ordered]@{ phase = $Phase; command_id = $CommandId; process_identity = $ProcessIdentity }
    try {
        $raw = & $ProcessFaultInjector $request
        $map = Copy-FoundationPublisherPlainDtoMap -Value $raw -Expected @("inject", "error_type", "error_text")
        if (-not ($map["inject"] -is [bool])) { throw "PROCESS_FAULT_INJECTOR_INVALID" }
        foreach ($name in @("error_type", "error_text")) {
            if ($null -ne $map[$name] -and -not ($map[$name] -is [string])) { throw "PROCESS_FAULT_INJECTOR_INVALID" }
        }
        $inject = [bool]$map["inject"]
        if ($inject) {
            if ([bool]$FaultState.injected -or [string]::IsNullOrWhiteSpace([string]$map["error_type"]) -or [string]::IsNullOrWhiteSpace([string]$map["error_text"])) {
                throw "PROCESS_FAULT_INJECTOR_INVALID"
            }
            $FaultState.phase = $Phase
            $FaultState.injected = $true
            $FaultState.error_type = [string]$map["error_type"]
            $FaultState.error_text = [string]$map["error_text"]
        }
        elseif ($null -ne $map["error_type"] -or $null -ne $map["error_text"]) { throw "PROCESS_FAULT_INJECTOR_INVALID" }
        return $inject
    }
    catch {
        if ([string]$_.Exception.Message -like "PROCESS_FAULT_INJECTOR_INVALID*") { throw }
        throw "PROCESS_FAULT_INJECTOR_INVALID:$($_.Exception.Message)"
    }
}

function Complete-FoundationProcessFaultResult {
    param(
        [Parameter(Mandatory = $true)]$Result,
        [Parameter(Mandatory = $true)]$FaultState,
        [AllowNull()][scriptblock]$ProcessFaultInjector,
        [Parameter(Mandatory = $true)][string]$CommandId,
        [AllowNull()]$ProcessIdentity,
        [bool]$SessionExists
    )
    if ($SessionExists -and -not [bool]$FaultState.injected) {
        try { [void](Invoke-FoundationProcessFaultProbe -ProcessFaultInjector $ProcessFaultInjector -FaultState $FaultState -Phase "job_close" -CommandId $CommandId -ProcessIdentity $ProcessIdentity) }
        catch {
            if (-not [bool]$FaultState.injected) {
                $FaultState.phase = "job_close"
                $FaultState.injected = $true
                $FaultState.error_type = "PROCESS_FAULT_INJECTOR_INVALID"
                $FaultState.error_text = $_.Exception.ToString()
            }
        }
    }
    $Result | Add-Member -NotePropertyName fault_injection -NotePropertyValue ([pscustomobject][ordered]@{
        active = [bool]$FaultState.active
        phase = $FaultState.phase
        injected = [bool]$FaultState.injected
        error_type = $FaultState.error_type
        error_text = $FaultState.error_text
    }) -Force
    if ([bool]$FaultState.injected -and -not [bool]$Result.timed_out) {
        $code = Get-FoundationProcessFaultErrorCode ([string]$FaultState.phase)
        $Result.status = "failed"
        $Result.error_code = $code
        $Result.exception_type = if ([string]::IsNullOrWhiteSpace([string]$FaultState.error_type)) { $code } else { [string]$FaultState.error_type }
        $Result.exception_text = if ([string]::IsNullOrWhiteSpace([string]$FaultState.error_text)) { $code } else { [string]$FaultState.error_text }
    }
    return $Result
}

function Invoke-FoundationProcessCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$CommandSpec,
        [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$TimeoutMs,
        [AllowNull()][scriptblock]$TerminationRunner = $null,
        [AllowNull()][scriptblock]$ProcessFaultInjector = $null
    )
    $started = [datetimeoffset]::Now
    $environmentNames = New-Object System.Collections.ArrayList
    $environmentSources = New-Object System.Collections.ArrayList
    $session = $null
    $processIdentity = $null
    $processId = $null
    $processStarted = $false
    $stdoutCapture = $null
    $stderrCapture = $null
    $jobControl = $null
    $taskkill = New-FoundationEmptyTaskkillResult
    $terminationErrors = New-Object System.Collections.ArrayList
    $streamCapture = [pscustomobject]@{ stdout_completed = $false; stderr_completed = $false; deadline_exceeded = $false }
    $faultState = New-FoundationProcessFaultState $ProcessFaultInjector
    $evidencePending = $null -ne $CommandSpec.PSObject.Properties["node_runtime"] -and $null -ne $CommandSpec.node_runtime
    try {
        Initialize-FoundationEmbeddedNativeAssembly
        $environmentEntries = @(Copy-FoundationProcessEnvironmentEntries -Policy $CommandSpec.environment_policy)
        $environmentBlockEntries = New-Object System.Collections.ArrayList
        foreach ($entry in $environmentEntries) {
            [void]$environmentNames.Add([string]$entry.name)
            [void]$environmentSources.Add([string]$entry.source)
            [void]$environmentBlockEntries.Add(('{0}={1}' -f [string]$entry.name, [string]$entry.value))
        }
        $application = ConvertTo-FoundationStrictLocalPath ([string]$CommandSpec.executable)
        $workingDirectory = ConvertTo-FoundationStrictLocalPath ([string]$CommandSpec.cwd)
        $argumentText = @($CommandSpec.arguments | ForEach-Object { ConvertTo-FoundationWindowsArgument ([string]$_) }) -join " "
        $commandLine = (ConvertTo-FoundationWindowsArgument $application) + $(if ([string]::IsNullOrEmpty($argumentText)) { "" } else { " " + $argumentText })
        if (Invoke-FoundationProcessFaultProbe -ProcessFaultInjector $ProcessFaultInjector -FaultState $faultState -Phase "create_before_job" -CommandId ([string]$CommandSpec.id) -ProcessIdentity $null) {
            throw "PROCESS_FAULT_INJECTED:create_before_job"
        }
        [Func[string, int, long, string, bool]]$nativeFaultProbe = $null
        if ($null -ne $ProcessFaultInjector) {
            $nativeFaultScript = {
                param([string]$phase, [int]$nativePid, [long]$nativeStart, [string]$nativePath)
                $nativeIdentity = New-FoundationProcessFaultIdentity -ProcessId $nativePid -StartTimeFileTimeUtc $nativeStart -ExecutablePath $nativePath
                return [bool](Invoke-FoundationProcessFaultProbe -ProcessFaultInjector $ProcessFaultInjector -FaultState $faultState -Phase $phase -CommandId ([string]$CommandSpec.id) -ProcessIdentity $nativeIdentity)
            }.GetNewClosure()
            $nativeFaultProbe = [Func[string, int, long, string, bool]]$nativeFaultScript
        }
        $session = [FoundationValidationNativeProcessSession]::Create($application, $commandLine, $workingDirectory, [string[]]@($environmentBlockEntries), $nativeFaultProbe)
        $processStarted = $true
        $processId = [int]$session.Id
        $processIdentity = Get-FoundationNativeProcessIdentity -Session $session
        $stdoutCapture = New-Object FoundationValidationAsyncStreamCapture -ArgumentList $session.StandardOutput
        $stderrCapture = New-Object FoundationValidationAsyncStreamCapture -ArgumentList $session.StandardError
        if (Invoke-FoundationProcessFaultProbe -ProcessFaultInjector $ProcessFaultInjector -FaultState $faultState -Phase "stream_stdout_fault" -CommandId ([string]$CommandSpec.id) -ProcessIdentity $processIdentity) {
            throw "PROCESS_FAULT_INJECTED:stream_stdout_fault"
        }
        if (Invoke-FoundationProcessFaultProbe -ProcessFaultInjector $ProcessFaultInjector -FaultState $faultState -Phase "stream_stderr_cancel" -CommandId ([string]$CommandSpec.id) -ProcessIdentity $processIdentity) {
            throw "PROCESS_FAULT_INJECTED:stream_stderr_cancel"
        }
        $mainCompleted = $session.WaitForExit($TimeoutMs)
        if (-not $mainCompleted) {
            $terminationRequest = [pscustomobject]@{ path = "C:\Windows\System32\taskkill.exe"; arguments = @("/PID", [string]$processId, "/T", "/F"); timeout_ms = 5000 }
            if ($null -eq $TerminationRunner) { $terminationValue = Invoke-FoundationTaskkill -ProcessId $processId -TimeoutMs 5000 }
            else { $terminationValue = & $TerminationRunner $terminationRequest }
            $taskkill = ConvertTo-FoundationTaskkillResult $terminationValue $terminationRequest
            if ([bool]$taskkill.timed_out) {
                [void]$terminationErrors.Add([pscustomobject]@{ category = "termination"; error_code = "PROCESS_TERMINATION_TIMEOUT"; error_type = "System.TimeoutException"; error_text = [string]$taskkill.error_text })
            }
            elseif ($null -eq $taskkill.exit_code -or [int]$taskkill.exit_code -ne 0) {
                $terminationText = [string]$taskkill.error_text
                if ([string]::IsNullOrWhiteSpace($terminationText)) {
                    $terminationDetail = if ([string]::IsNullOrWhiteSpace([string]$taskkill.stderr)) { "no stderr" } else { ([string]$taskkill.stderr).Trim() }
                    $terminationText = "taskkill exit code $($taskkill.exit_code); $terminationDetail"
                    $taskkill.error_type = "NativeCommandExitCode"
                    $taskkill.error_text = $terminationText
                }
                [void]$terminationErrors.Add([pscustomobject]@{ category = "termination"; error_code = "PROCESS_TERMINATION_COMMAND_FAILED"; error_type = "NativeCommandExitCode"; error_text = $terminationText })
            }
            $parentExited = [bool]$session.HasExited
            if (-not $parentExited) { $parentExited = $session.WaitForExit(5000) }
            if (-not $parentExited) {
                [void]$terminationErrors.Add([pscustomobject]@{ category = "termination"; error_code = "PROCESS_EXIT_GRACE_EXCEEDED"; error_type = "System.TimeoutException"; error_text = "parent exit grace exceeded 5000ms" })
                [void]$session.TerminateJob(1)
                $parentExited = $session.WaitForExit(5000)
            }
            $streamsCompleted = [FoundationValidationAsyncStreamCapture]::WaitBoth($stdoutCapture, $stderrCapture, 5000)
            $streamCapture.stdout_completed = [bool]$stdoutCapture.Completion.IsCompleted
            $streamCapture.stderr_completed = [bool]$stderrCapture.Completion.IsCompleted
            if (-not $streamsCompleted -or -not $streamCapture.stdout_completed -or -not $streamCapture.stderr_completed) {
                $streamCapture.deadline_exceeded = $true
                [void]$terminationErrors.Add([pscustomobject]@{ category = "termination"; error_code = "PROCESS_STREAM_DRAIN_TIMEOUT"; error_type = "System.TimeoutException"; error_text = "stream drain exceeded 5000ms" })
                [void]$session.TerminateJob(1)
                [void][FoundationValidationAsyncStreamCapture]::WaitBoth($stdoutCapture, $stderrCapture, 5000)
            }
            [void]$session.WaitForJobEmpty(5000)
            $jobControl = Get-FoundationNativeJobControl -Session $session -ProcessIdentity $processIdentity -CommandSpec $CommandSpec -EvidencePending $evidencePending
            $result = [pscustomobject]@{
                started_at = $started; finished_at = [datetimeoffset]::Now; status = "failed"; exit_code = if ($session.HasExited) { [int]$session.ExitCode } else { $null }
                stdout = $stdoutCapture.Snapshot(); stderr = $stderrCapture.Snapshot(); exception_type = "PROCESS_TIMEOUT"; exception_text = "PROCESS_TIMEOUT after $TimeoutMs ms"
                environment_key_names = @($environmentNames); environment_value_sources = @($environmentSources); timeout_ms = $TimeoutMs; timed_out = $true
                process_id = $processId; process_identity = $processIdentity; job_control = $jobControl; taskkill = $taskkill; error_code = "PROCESS_TIMEOUT"; stream_capture = $streamCapture; termination_errors = @($terminationErrors)
            }
            if ($evidencePending) { $result | Add-Member -NotePropertyName foundation_native_evidence_pending -NotePropertyValue $true }
            return (Complete-FoundationProcessFaultResult -Result $result -FaultState $faultState -ProcessFaultInjector $ProcessFaultInjector -CommandId ([string]$CommandSpec.id) -ProcessIdentity $processIdentity -SessionExists $true)
        }

        $streamsCompleted = [FoundationValidationAsyncStreamCapture]::WaitBoth($stdoutCapture, $stderrCapture, 5000)
        $streamCapture.stdout_completed = [bool]$stdoutCapture.Completion.IsCompleted
        $streamCapture.stderr_completed = [bool]$stderrCapture.Completion.IsCompleted
        if (-not $streamsCompleted -or -not $streamCapture.stdout_completed -or -not $streamCapture.stderr_completed) {
            $streamCapture.deadline_exceeded = $true
            [void]$terminationErrors.Add([pscustomobject]@{ category = "termination"; error_code = "PROCESS_STREAM_DRAIN_TIMEOUT"; error_type = "System.TimeoutException"; error_text = "stream drain exceeded 5000ms" })
            [void]$session.TerminateJob(1)
            [void][FoundationValidationAsyncStreamCapture]::WaitBoth($stdoutCapture, $stderrCapture, 5000)
            $jobControl = Get-FoundationNativeJobControl -Session $session -ProcessIdentity $processIdentity -CommandSpec $CommandSpec -EvidencePending $evidencePending
            $result = [pscustomobject]@{
                started_at = $started; finished_at = [datetimeoffset]::Now; status = "failed"; exit_code = if ($session.HasExited) { [int]$session.ExitCode } else { $null }
                stdout = $stdoutCapture.Snapshot(); stderr = $stderrCapture.Snapshot(); exception_type = "PROCESS_STREAM_DRAIN_TIMEOUT"; exception_text = "stream drain exceeded 5000ms"
                environment_key_names = @($environmentNames); environment_value_sources = @($environmentSources); timeout_ms = $TimeoutMs; timed_out = $false
                process_id = $processId; process_identity = $processIdentity; job_control = $jobControl; taskkill = $taskkill; error_code = "PROCESS_STREAM_DRAIN_TIMEOUT"; stream_capture = $streamCapture; termination_errors = @($terminationErrors)
            }
            if ($evidencePending) { $result | Add-Member -NotePropertyName foundation_native_evidence_pending -NotePropertyValue $true }
            return (Complete-FoundationProcessFaultResult -Result $result -FaultState $faultState -ProcessFaultInjector $ProcessFaultInjector -CommandId ([string]$CommandSpec.id) -ProcessIdentity $processIdentity -SessionExists $true)
        }

        $jobEmpty = $session.WaitForJobEmpty(5000)
        if (-not $jobEmpty) { [void]$session.TerminateJob(1) }
        if (Invoke-FoundationProcessFaultProbe -ProcessFaultInjector $ProcessFaultInjector -FaultState $faultState -Phase "job_query" -CommandId ([string]$CommandSpec.id) -ProcessIdentity $processIdentity) {
            throw "PROCESS_FAULT_INJECTED:job_query"
        }
        $jobControl = Get-FoundationNativeJobControl -Session $session -ProcessIdentity $processIdentity -CommandSpec $CommandSpec -EvidencePending $evidencePending
        $forcedJobCode = $null
        if (Invoke-FoundationProcessFaultProbe -ProcessFaultInjector $ProcessFaultInjector -FaultState $faultState -Phase "job_completion_event" -CommandId ([string]$CommandSpec.id) -ProcessIdentity $processIdentity) {
            $jobControl.completion_telemetry.identity_failures = @([pscustomobject][ordered]@{ pid = [int]$processIdentity.pid; error_text = [string]$faultState.error_text })
            $jobControl.accounting.matched = $false
            $forcedJobCode = "PROCESS_COMPLETION_TELEMETRY_INCOMPLETE"
        }
        if (-not [bool]$faultState.injected -and (Invoke-FoundationProcessFaultProbe -ProcessFaultInjector $ProcessFaultInjector -FaultState $faultState -Phase "job_accounting_query" -CommandId ([string]$CommandSpec.id) -ProcessIdentity $processIdentity)) {
            $jobControl.accounting.expected_total_processes = [int]$jobControl.accounting.total_processes + 1
            $jobControl.accounting.matched = $false
            $forcedJobCode = "PROCESS_JOB_ACCOUNTING_MISMATCH"
        }
        $exitCode = [int]$session.ExitCode
        $jobMismatch = $null -ne $forcedJobCode -or (-not $evidencePending -and (-not [bool]$jobControl.accounting.matched -or -not [bool]$jobControl.completion_telemetry.active_zero_observed))
        $jobErrorCode = if ($null -ne $forcedJobCode) { [string]$forcedJobCode } else { "PROCESS_JOB_ACCOUNTING_MISMATCH" }
        $result = [pscustomobject]@{
            started_at = $started; finished_at = [datetimeoffset]::Now; status = if ($exitCode -eq 0 -and -not $jobMismatch) { "passed" } else { "failed" }; exit_code = $exitCode
            stdout = $stdoutCapture.Snapshot(); stderr = $stderrCapture.Snapshot(); exception_type = if ($jobMismatch) { $jobErrorCode } else { $null }; exception_text = if ($jobMismatch) { if ($null -ne $forcedJobCode) { [string]$faultState.error_text } else { $jobErrorCode } } else { $null }
            environment_key_names = @($environmentNames); environment_value_sources = @($environmentSources); timeout_ms = $TimeoutMs; timed_out = $false
            process_id = $processId; process_identity = $processIdentity; job_control = $jobControl; taskkill = $taskkill; error_code = if ($jobMismatch) { $jobErrorCode } elseif ($exitCode -eq 0) { $null } else { [string]$exitCode }; stream_capture = $streamCapture; termination_errors = @()
        }
        if ($evidencePending) { $result | Add-Member -NotePropertyName foundation_native_evidence_pending -NotePropertyValue $true }
        return (Complete-FoundationProcessFaultResult -Result $result -FaultState $faultState -ProcessFaultInjector $ProcessFaultInjector -CommandId ([string]$CommandSpec.id) -ProcessIdentity $processIdentity -SessionExists $true)
    }
    catch {
        $runtimeCode = if ([bool]$faultState.injected) { Get-FoundationProcessFaultErrorCode ([string]$faultState.phase) } elseif ($processStarted) { "PROCESS_RUNTIME_FAILED" } else { "PROCESS_START_FAILED" }
        if ($processStarted -and $null -ne $session) {
            try { [void]$session.TerminateJob(1) } catch { }
            try { if ($null -ne $stdoutCapture -and $null -ne $stderrCapture) { [void][FoundationValidationAsyncStreamCapture]::WaitBoth($stdoutCapture, $stderrCapture, 5000) } } catch { }
            try { if ($null -ne $processIdentity) { $jobControl = Get-FoundationNativeJobControl -Session $session -ProcessIdentity $processIdentity -CommandSpec $CommandSpec -EvidencePending $evidencePending } } catch { }
        }
        $result = [pscustomobject]@{
            started_at = $started; finished_at = [datetimeoffset]::Now; status = "failed"; exit_code = $null
            stdout = if ($null -eq $stdoutCapture) { "" } else { $stdoutCapture.Snapshot() }; stderr = if ($null -eq $stderrCapture) { "" } else { $stderrCapture.Snapshot() }; exception_type = if ([bool]$faultState.injected) { [string]$faultState.error_type } else { $runtimeCode }; exception_text = if ([bool]$faultState.injected) { [string]$faultState.error_text } else { $_.Exception.ToString() }
            environment_key_names = @($environmentNames); environment_value_sources = @($environmentSources); timeout_ms = $TimeoutMs; timed_out = $false
            process_id = $processId; process_identity = $processIdentity; job_control = $jobControl; taskkill = $taskkill; error_code = $runtimeCode; stream_capture = $streamCapture; termination_errors = @($terminationErrors)
        }
        return (Complete-FoundationProcessFaultResult -Result $result -FaultState $faultState -ProcessFaultInjector $ProcessFaultInjector -CommandId ([string]$CommandSpec.id) -ProcessIdentity $processIdentity -SessionExists ([bool]($null -ne $session)))
    }
    finally {
        if ($null -ne $session) { $session.Dispose() }
    }
}

function Invoke-FoundationDefaultCleanup {
    param($Spec)
    try {
        $trusted = Get-FoundationFullPath ([string]$Spec.trusted_parent)
        $expected = Get-FoundationFullPath (Join-Path (Join-Path $trusted ([string]$Spec.task_id)) ([string]$Spec.run_id))
        $actual = Get-FoundationFullPath ([string]$Spec.path)
        if (-not $actual.Equals($expected, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "TEMP_ROOT_CLEANUP_PATH_REJECTED"
        }
        $resolved = Resolve-FoundationChildPath -TrustedParent $trusted -CandidateRelativePath $actual -ExpectedLeaf ([string]$Spec.run_id)
        if (-not $resolved.allowed) { throw [string]$resolved.error_code }
        $cleanupResult = Remove-FoundationHandleBoundTree -TrustedParent $trusted -Path $actual -ExpectedIdentity $Spec.path_identity
        $physical = Get-FoundationPhysicalResidual -TrustedParent $trusted -Path $actual
        $residual = [int]$physical.physical_residual_count
        return [pscustomobject]@{ attempted = $true; succeeded = ($residual -eq 0); residual_count = $residual; error_type = $null; error_text = $null }
    }
    catch {
        return [pscustomobject]@{ attempted = $true; succeeded = $false; residual_count = 1; error_type = $_.Exception.GetType().FullName; error_text = $_.Exception.ToString() }
    }
}

function Copy-FoundationCleanupAdapterResult {
    param($Result)
    Assert-FoundationExactPropertySet $Result @("attempted", "succeeded", "residual_count", "error_type", "error_text") "CLEANUP_ADAPTER_RESULT_INVALID"
    if (-not ($Result.attempted -is [bool]) -or -not ($Result.succeeded -is [bool])) { throw "CLEANUP_ADAPTER_RESULT_INVALID" }
    [int]$adapterResidual = 0
    try { $adapterResidual = [int]$Result.residual_count } catch { throw "CLEANUP_ADAPTER_RESULT_INVALID" }
    if ($adapterResidual -lt 0) { throw "CLEANUP_ADAPTER_RESULT_INVALID" }
    return [pscustomobject][ordered]@{
        attempted = [bool]$Result.attempted
        succeeded = [bool]$Result.succeeded
        residual_count = $adapterResidual
        error_type = if ($null -eq $Result.error_type) { $null } else { [string]$Result.error_type }
        error_text = if ($null -eq $Result.error_text) { $null } else { [string]$Result.error_text }
    }
}

function Get-FoundationNativePathState {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][bool]$ShareWrite)
    Initialize-FoundationNativePathType
    $full = ConvertTo-FoundationStrictLocalPath $Path
    $nativeError = 0
    $handle = [FoundationValidationNativePath]::TryOpenMetadata($full, $ShareWrite, [ref]$nativeError)
    if ($null -eq $handle) {
        if ($nativeError -in @(2, 3)) { return [pscustomobject][ordered]@{ exists = $false; path = $full; handle = $null; info = $null } }
        throw "PATH_OPERATION_FAILED:CreateFileW:${full}:$nativeError"
    }
    try {
        $info = [FoundationValidationNativePath]::GetInfo($handle)
        $finalPath = ConvertFrom-FoundationFinalHandlePath ([string]$info.FinalPath)
        if (-not $finalPath.Equals($full, [System.StringComparison]::OrdinalIgnoreCase)) { throw "PATH_IDENTITY_CHANGED:$full" }
        return [pscustomobject][ordered]@{ exists = $true; path = $full; handle = $handle; info = $info }
    }
    catch {
        $handle.Dispose()
        throw
    }
}

function Join-FoundationValidatedChildPath {
    param([Parameter(Mandatory = $true)][string]$Parent, [Parameter(Mandatory = $true)][string]$Name)
    if ([string]::IsNullOrWhiteSpace($Name) -or $Name -in @(".", "..") -or
        $Name.IndexOfAny(@([char]'\', [char]'/', [char]':', [char]0)) -ge 0) {
        throw "PATH_OPERATION_FAILED:invalid_directory_entry"
    }
    return $Parent.TrimEnd("\") + "\" + $Name
}

function Get-FoundationPinnedDirectoryChildren {
    param(
        [Parameter(Mandatory = $true)][string]$TrustedRoot,
        [Parameter(Mandatory = $true)][string]$DirectoryPath,
        [Parameter(Mandatory = $true)]$DirectoryHandle,
        [Parameter(Mandatory = $true)][ValidateSet("immutable", "delete", "read")][string]$OpenMode
    )
    $rootFull = ConvertTo-FoundationStrictLocalPath $TrustedRoot
    $directoryFull = ConvertTo-FoundationStrictLocalPath $DirectoryPath
    $childrenByName = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([System.StringComparer]::OrdinalIgnoreCase)
    $restart = $true
    try {
        while ($true) {
            $batch = [FoundationValidationNativePath]::EnumerateDirectoryHandleBatch($DirectoryHandle, $restart)
            $restart = $false
            foreach ($nativeEntry in @($batch.Entries)) {
                $name = [string]$nativeEntry.Name
                if ($childrenByName.ContainsKey($name)) { throw "PATH_IDENTITY_CHANGED:duplicate_directory_entry:$name" }
                $childPath = Join-FoundationValidatedChildPath -Parent $directoryFull -Name $name
                if (-not (Test-FoundationPathContained -Parent $rootFull -Candidate $childPath)) { throw "PATH_OUTSIDE_ALLOWED_ROOT" }
                $childHandle = $null
                try {
                    if ($OpenMode -ceq "immutable") {
                        $childHandle = [FoundationValidationNativePath]::OpenImmutableRead($childPath)
                    }
                    elseif ($OpenMode -ceq "delete") {
                        $childHandle = [FoundationValidationNativePath]::OpenDeleteNoFollow($childPath)
                    }
                    else {
                        $childError = 0
                        $childHandle = [FoundationValidationNativePath]::TryOpenReadNoFollow($childPath, [ref]$childError)
                        if ($null -eq $childHandle) { throw "PATH_IDENTITY_CHANGED:${childPath}:$childError" }
                    }
                    $childInfo = [FoundationValidationNativePath]::GetInfo($childHandle)
                    $childFinal = ConvertFrom-FoundationFinalHandlePath ([string]$childInfo.FinalPath)
                    if (-not $childFinal.Equals($childPath, [System.StringComparison]::OrdinalIgnoreCase)) { throw "PATH_IDENTITY_CHANGED:$childPath" }
                    $childrenByName.Add($name, [pscustomobject][ordered]@{
                        name = $name
                        path = $childPath
                        handle = $childHandle
                        info = $childInfo
                        is_directory = (($childInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0)
                        is_reparse = (($childInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0)
                    })
                    $childHandle = $null
                }
                finally {
                    if ($null -ne $childHandle) { $childHandle.Dispose() }
                }
            }
            if ([bool]$batch.Completed) { break }
        }
        $names = New-Object 'System.Collections.Generic.List[string]'
        foreach ($name in @($childrenByName.Keys)) { $names.Add([string]$name) }
        $names.Sort([System.StringComparer]::OrdinalIgnoreCase)
        $ordered = New-Object System.Collections.ArrayList
        foreach ($name in @($names)) { [void]$ordered.Add($childrenByName[[string]$name]) }
        return [pscustomobject][ordered]@{ entries = @($ordered) }
    }
    catch {
        foreach ($child in @($childrenByName.Values)) { if ($null -ne $child.handle) { $child.handle.Dispose() } }
        throw
    }
}

function Remove-FoundationHandleBoundEntry {
    param([Parameter(Mandatory = $true)][string]$TrustedRoot, [Parameter(Mandatory = $true)][string]$Path, $ExpectedIdentity = $null, $ExistingHandle = $null, [bool]$PathAlreadyValidated = $false)
    Initialize-FoundationNativePathType
    $rootFull = ConvertTo-FoundationStrictLocalPath $TrustedRoot
    $pathFull = if ($PathAlreadyValidated) { [string]$Path } else { ConvertTo-FoundationStrictLocalPath $Path }
    if ($PathAlreadyValidated) {
        $rootPrefix = $rootFull.TrimEnd("\") + "\"
        if (-not $pathFull.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "PATH_OUTSIDE_ALLOWED_ROOT" }
    }
    elseif (-not (Test-FoundationPathContained -Parent $rootFull -Candidate $pathFull -AllowEqual)) { throw "PATH_OUTSIDE_ALLOWED_ROOT" }
    $handle = $ExistingHandle
    try {
        if ($null -eq $handle) {
            $deleteError = 0
            $handle = [FoundationValidationNativePath]::TryOpenDeleteNoFollow($pathFull, [ref]$deleteError)
            if ($null -eq $handle) {
                if ($null -ne $ExpectedIdentity -and $deleteError -in @(2, 3)) { throw "PATH_IDENTITY_CHANGED:${pathFull}:$deleteError" }
                throw "PATH_IDENTITY_CHANGED:${pathFull}:$deleteError"
            }
        }
        $info = [FoundationValidationNativePath]::GetInfo($handle)
        $finalPath = ConvertFrom-FoundationFinalHandlePath ([string]$info.FinalPath)
        if (-not $finalPath.Equals($pathFull, [System.StringComparison]::OrdinalIgnoreCase)) { throw "PATH_IDENTITY_CHANGED:$pathFull" }
        if ($null -ne $ExpectedIdentity -and
            ([string]$info.VolumeSerial -cne [string]$ExpectedIdentity.volume_serial -or [string]$info.FileId -cne [string]$ExpectedIdentity.file_id)) {
            throw "PATH_IDENTITY_CHANGED:$pathFull"
        }
        $isDirectory = ($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0
        $isReparse = ($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0
        if ($null -ne $ExpectedIdentity -and ($isReparse -or -not $isDirectory)) { throw "PATH_IDENTITY_CHANGED:$pathFull" }
        if ($isDirectory -and -not $isReparse) {
            $childBatch = Get-FoundationPinnedDirectoryChildren -TrustedRoot $rootFull -DirectoryPath $pathFull -DirectoryHandle $handle -OpenMode delete
            $childHandles = @($childBatch.entries)
            try {
                foreach ($child in @($childHandles)) {
                    Remove-FoundationHandleBoundEntry -TrustedRoot $rootFull -Path ([string]$child.path) -ExistingHandle $child.handle -PathAlreadyValidated $true
                    $child.handle = $null
                }
            }
            finally {
                foreach ($child in @($childHandles)) { if ($null -ne $child.handle) { $child.handle.Dispose() } }
            }
            $remainingBatch = Get-FoundationPinnedDirectoryChildren -TrustedRoot $rootFull -DirectoryPath $pathFull -DirectoryHandle $handle -OpenMode delete
            try {
                if (@($remainingBatch.entries).Count -ne 0) { throw "PATH_IDENTITY_CHANGED:$pathFull" }
            }
            finally {
                foreach ($child in @($remainingBatch.entries)) { if ($null -ne $child.handle) { $child.handle.Dispose() } }
            }
        }
        [FoundationValidationNativePath]::MarkDelete($handle)
    }
    finally {
        if ($null -ne $handle) { $handle.Dispose() }
    }
}

function Remove-FoundationHandleBoundTree {
    param([Parameter(Mandatory = $true)][string]$TrustedParent, [Parameter(Mandatory = $true)][string]$Path, $ExpectedIdentity = $null)
    $trustedFull = ConvertTo-FoundationStrictLocalPath $TrustedParent
    $pathFull = ConvertTo-FoundationStrictLocalPath $Path
    if (-not (Test-FoundationPathContained -Parent $trustedFull -Candidate $pathFull)) { throw "PATH_OUTSIDE_ALLOWED_ROOT" }
    $trustedPins = New-FoundationPinnedPathChain -Path $trustedFull -ShareWrite $true -AllowMissing $false
    try {
        $state = Get-FoundationNativePathState -Path $pathFull -ShareWrite $true
        if (-not [bool]$state.exists) {
            if ($null -ne $ExpectedIdentity) { throw "PATH_IDENTITY_CHANGED:$pathFull" }
            return [pscustomobject][ordered]@{ attempted = $true; succeeded = $true; already_missing = $true }
        }
        try { $state.handle.Dispose() } catch { }
        Remove-FoundationHandleBoundEntry -TrustedRoot $trustedFull -Path $pathFull -ExpectedIdentity $ExpectedIdentity
        $after = Get-FoundationNativePathState -Path $pathFull -ShareWrite $true
        if ([bool]$after.exists) {
            try { $after.handle.Dispose() } catch { }
            throw "PATH_OPERATION_FAILED:cleanup_entry_remained:$pathFull"
        }
        return [pscustomobject][ordered]@{ attempted = $true; succeeded = $true; already_missing = $false }
    }
    finally {
        Close-FoundationPinSet $trustedPins
    }
}

function Add-FoundationPhysicalResidualEntries {
    param([string]$TrustedRoot, [string]$Path, $Sink, $ExistingHandle = $null, [bool]$PathAlreadyValidated = $false)
    Initialize-FoundationNativePathType
    $pathFull = if ($PathAlreadyValidated) { [string]$Path } else { ConvertTo-FoundationStrictLocalPath $Path }
    $handle = $ExistingHandle
    if ($null -eq $handle) {
        $nativeError = 0
        $handle = [FoundationValidationNativePath]::TryOpenReadNoFollow($pathFull, [ref]$nativeError)
        if ($null -eq $handle) {
            if ($nativeError -in @(2, 3)) { return }
            throw "PATH_OPERATION_FAILED:CreateFileW:${pathFull}:$nativeError"
        }
    }
    try {
        $info = [FoundationValidationNativePath]::GetInfo($handle)
        $finalPath = ConvertFrom-FoundationFinalHandlePath ([string]$info.FinalPath)
        if (-not $finalPath.Equals($pathFull, [System.StringComparison]::OrdinalIgnoreCase)) { throw "PATH_IDENTITY_CHANGED:$pathFull" }
        $isDirectory = ($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0
        $isReparse = ($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0
        [void]$Sink.Add([pscustomobject][ordered]@{
            path = $pathFull
            volume_serial = [string]$info.VolumeSerial
            file_id = [string]$info.FileId
            attributes = [uint32]$info.Attributes
            entry_kind = if ($isReparse) { "reparse_leaf" } elseif ($isDirectory) { "directory" } else { "file" }
            length = if ($isDirectory) { $null } else { [long]$info.Length }
        })
        if ($isDirectory -and -not $isReparse) {
            $childBatch = Get-FoundationPinnedDirectoryChildren -TrustedRoot $TrustedRoot -DirectoryPath $pathFull -DirectoryHandle $handle -OpenMode read
            $childHandles = @($childBatch.entries)
            try {
                foreach ($child in @($childHandles)) {
                    Add-FoundationPhysicalResidualEntries -TrustedRoot $TrustedRoot -Path ([string]$child.path) -Sink $Sink -ExistingHandle $child.handle -PathAlreadyValidated $true
                    $child.handle = $null
                }
            }
            finally {
                foreach ($child in @($childHandles)) { if ($null -ne $child.handle) { $child.handle.Dispose() } }
            }
        }
    }
    finally {
        if ($null -ne $handle) { $handle.Dispose() }
    }
}

function Get-FoundationPhysicalResidual {
    param([Parameter(Mandatory = $true)][string]$TrustedParent, [Parameter(Mandatory = $true)][string]$Path)
    $trustedFull = ConvertTo-FoundationStrictLocalPath $TrustedParent
    $pathFull = ConvertTo-FoundationStrictLocalPath $Path
    if (-not (Test-FoundationPathContained -Parent $trustedFull -Candidate $pathFull)) { throw "PATH_OUTSIDE_ALLOWED_ROOT" }
    $trustedPins = New-FoundationPinnedPathChain -Path $trustedFull -ShareWrite $true -AllowMissing $false
    $entries = New-Object System.Collections.ArrayList
    try {
        Add-FoundationPhysicalResidualEntries -TrustedRoot $pathFull -Path $pathFull -Sink $entries
        return [pscustomobject][ordered]@{ physical_residual_entries = @($entries); physical_residual_count = $entries.Count }
    }
    finally {
        Close-FoundationPinSet $trustedPins
    }
}

function Copy-FoundationPinnedFile {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    Initialize-FoundationNativePathType
    $sourceFull = ConvertTo-FoundationStrictLocalPath $Source
    $destinationFull = ConvertTo-FoundationStrictLocalPath $Destination
    $sourcePins = New-FoundationPinnedPathChain -Path $sourceFull -ShareWrite $false -AllowMissing $false
    $destinationPins = New-FoundationPinnedDirectory -Path (Split-Path -Parent $destinationFull) -OperationId "staging_destination_parent"
    $sourceHandle = $null
    $destinationHandle = $null
    try {
        $sourceHandle = [FoundationValidationNativePath]::OpenImmutableRead($sourceFull)
        $sourceInfo = [FoundationValidationNativePath]::GetInfo($sourceHandle)
        if (($sourceInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0 -or
            ($sourceInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0) {
            throw "STAGING_DEPENDENCY_INVALID: source leaf is not ordinary"
        }
        $bytes = [FoundationValidationNativePath]::ReadAll($sourceHandle)
        $sourceHash = Get-FoundationSha256Bytes $bytes
        $destinationHandle = [FoundationValidationNativePath]::CreateNewPinnedFile($destinationFull)
        [FoundationValidationNativePath]::WriteAll($destinationHandle, $bytes)
        $destinationInfo = [FoundationValidationNativePath]::GetInfo($destinationHandle)
        $destinationHash = [FoundationValidationNativePath]::Sha256($destinationHandle)
        $finalPath = ConvertFrom-FoundationFinalHandlePath ([string]$destinationInfo.FinalPath)
        if (($destinationInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0 -or
            $destinationInfo.Length -ne $sourceInfo.Length -or $destinationHash -cne $sourceHash -or
            -not $finalPath.Equals($destinationFull, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "PATH_OPERATION_FAILED: staging destination verification"
        }
    }
    finally {
        if ($null -ne $destinationHandle) { $destinationHandle.Dispose() }
        if ($null -ne $sourceHandle) { $sourceHandle.Dispose() }
        Close-FoundationPinSet $destinationPins
        Close-FoundationPinSet $sourcePins
    }
}

function Copy-FoundationOrdinaryTree {
    param([string]$Source, [string]$Destination, [switch]$RejectEnvironmentFiles)
    $sourceFull = ConvertTo-FoundationStrictLocalPath $Source
    $destinationFull = ConvertTo-FoundationStrictLocalPath $Destination
    $destinationRootPins = New-FoundationPinnedDirectory -Path $destinationFull -OperationId "staging_tree_root"
    try {
        $copyState = [pscustomobject]@{ destination_root = $destinationFull }
        $copyVisitor = {
            param($Entry, $State)
            if ([bool]$Entry.is_reparse) { throw "STAGING_DEPENDENCY_INVALID: reparse descendant" }
            if ([bool]$State.reject_environment_files -and ([string]$Entry.name).StartsWith(".env", [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "STAGING_DEPENDENCY_INVALID: environment file"
            }
            $destinationPath = Join-FoundationValidatedRelativePath -Root ([string]$State.destination_root) -RelativePath ([string]$Entry.relative_path)
            if ([bool]$Entry.is_directory) {
                $pins = New-FoundationPinnedDirectory -Path $destinationPath -OperationId "staging_tree_directory"
                Close-FoundationPinSet $pins
                return
            }
            Copy-FoundationPinnedHandleFile -SourceHandle $Entry.handle -SourceInfo $Entry.info -Destination $destinationPath
        }
        $copyState | Add-Member -NotePropertyName reject_environment_files -NotePropertyValue ([bool]$RejectEnvironmentFiles)
        Invoke-FoundationHandleTreeWalk -Root $sourceFull -Visitor $copyVisitor -State $copyState
    }
    finally {
        Close-FoundationPinSet $destinationRootPins
    }
}

function Join-FoundationValidatedRelativePath {
    param([Parameter(Mandatory = $true)][string]$Root, [Parameter(Mandatory = $true)][string]$RelativePath)
    $rootFull = ConvertTo-FoundationStrictLocalPath $Root
    if ([string]::IsNullOrWhiteSpace($RelativePath) -or $RelativePath.IndexOfAny(@([char]'/', [char]':', [char]0)) -ge 0) {
        throw "PATH_OPERATION_FAILED:invalid_relative_path"
    }
    $cursor = $rootFull
    foreach ($segment in @($RelativePath -split '\\')) {
        $cursor = Join-FoundationValidatedChildPath -Parent $cursor -Name $segment
    }
    return $cursor
}

function Get-FoundationLexicalParentPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    $full = ConvertTo-FoundationStrictLocalPath $Path
    $root = $full.Substring(0, 3)
    if ($full.Equals($root, [System.StringComparison]::OrdinalIgnoreCase)) { throw "PATH_OUTSIDE_ALLOWED_ROOT" }
    $separator = $full.LastIndexOf("\", [System.StringComparison]::Ordinal)
    if ($separator -lt 2) { throw "PATH_OUTSIDE_ALLOWED_ROOT" }
    if ($separator -eq 2) { return $root }
    return $full.Substring(0, $separator)
}

function Copy-FoundationPinnedHandleFile {
    param(
        [Parameter(Mandatory = $true)]$SourceHandle,
        [Parameter(Mandatory = $true)]$SourceInfo,
        [Parameter(Mandatory = $true)][string]$Destination,
        [AllowNull()][string]$ExpectedSha256 = $null,
        [AllowNull()][string]$ExpectedVolumeSerial = $null,
        [AllowNull()][string]$ExpectedFileId = $null,
        [AllowNull()][string]$ExpectedSourcePath = $null
    )
    $destinationFull = ConvertTo-FoundationStrictLocalPath $Destination
    if (($SourceInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0 -or
        ($SourceInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0) {
        throw "STAGING_DEPENDENCY_INVALID: source leaf is not ordinary"
    }
    $currentSourceInfo = [FoundationValidationNativePath]::GetInfo($SourceHandle)
    if (($currentSourceInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0 -or
        ($currentSourceInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0 -or
        [uint32]$currentSourceInfo.Attributes -ne [uint32]$SourceInfo.Attributes -or
        [long]$currentSourceInfo.Length -ne [long]$SourceInfo.Length -or
        (-not [string]::IsNullOrWhiteSpace($ExpectedVolumeSerial) -and [string]$currentSourceInfo.VolumeSerial -cne $ExpectedVolumeSerial) -or
        (-not [string]::IsNullOrWhiteSpace($ExpectedFileId) -and [string]$currentSourceInfo.FileId -cne $ExpectedFileId)) {
        throw "PATH_IDENTITY_CHANGED:source_identity"
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedSourcePath)) {
        $expectedSourceFull = ConvertTo-FoundationStrictLocalPath $ExpectedSourcePath
        $currentSourceFinal = ConvertFrom-FoundationFinalHandlePath ([string]$currentSourceInfo.FinalPath)
        if (-not $currentSourceFinal.Equals($expectedSourceFull, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "PATH_IDENTITY_CHANGED:source_path"
        }
    }
    $bytes = [FoundationValidationNativePath]::ReadAll($SourceHandle)
    $sourceHash = Get-FoundationSha256Bytes $bytes
    if ([long]$bytes.LongLength -ne [long]$SourceInfo.Length -or
        (-not [string]::IsNullOrWhiteSpace($ExpectedSha256) -and $sourceHash -cne $ExpectedSha256.ToUpperInvariant())) {
        throw "PATH_IDENTITY_CHANGED:source_hash"
    }
    $destinationPins = $null
    $destinationHandle = $null
    try {
        $destinationPins = New-FoundationPinnedDirectory -Path (Get-FoundationLexicalParentPath $destinationFull) -OperationId "pinned_copy_destination_parent"
        $destinationHandle = [FoundationValidationNativePath]::CreateNewPinnedFile($destinationFull)
        [FoundationValidationNativePath]::WriteAll($destinationHandle, $bytes)
        $destinationInfo = [FoundationValidationNativePath]::GetInfo($destinationHandle)
        $destinationHash = [FoundationValidationNativePath]::Sha256($destinationHandle)
        $finalPath = ConvertFrom-FoundationFinalHandlePath ([string]$destinationInfo.FinalPath)
        if (($destinationInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0 -or
            ($destinationInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0 -or
            [long]$destinationInfo.Length -ne [long]$SourceInfo.Length -or $destinationHash -cne $sourceHash -or
            -not $finalPath.Equals($destinationFull, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "PATH_OPERATION_FAILED: pinned destination verification"
        }
    }
    finally {
        if ($null -ne $destinationHandle) { $destinationHandle.Dispose() }
        Close-FoundationPinSet $destinationPins
    }
}

function Invoke-FoundationHandleTreeDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$DirectoryPath,
        [AllowEmptyString()][string]$DirectoryRelativePath,
        [Parameter(Mandatory = $true)]$DirectoryHandle,
        [Parameter(Mandatory = $true)][scriptblock]$Visitor,
        $State,
        $HeldHandlesSink = $null,
        $ShouldDescend = $null
    )
    $directoryInfo = [FoundationValidationNativePath]::GetInfo($DirectoryHandle)
    $directoryFinal = ConvertFrom-FoundationFinalHandlePath ([string]$directoryInfo.FinalPath)
    if (-not $directoryFinal.Equals($DirectoryPath, [System.StringComparison]::OrdinalIgnoreCase) -or
        ($directoryInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -eq 0 -or
        ($directoryInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0) {
        throw "PATH_IDENTITY_CHANGED:$DirectoryPath"
    }
    if ($null -ne $HeldHandlesSink) { [void]$HeldHandlesSink.Add([FoundationValidationNativePath]::DuplicatePinnedHandle($DirectoryHandle)) }
    $childBatch = Get-FoundationPinnedDirectoryChildren -TrustedRoot $Root -DirectoryPath $DirectoryPath -DirectoryHandle $DirectoryHandle -OpenMode immutable
    $childHandles = @($childBatch.entries)
    foreach ($child in @($childHandles)) {
        $relativePath = if ([string]::IsNullOrEmpty($DirectoryRelativePath)) { [string]$child.name } else { $DirectoryRelativePath + "\" + [string]$child.name }
        $child | Add-Member -NotePropertyName relative_path -NotePropertyValue $relativePath -Force
    }
    try {
        foreach ($child in @($childHandles)) {
            & $Visitor $child $State
            $descend = $true
            if ($null -ne $ShouldDescend) { $descend = [bool](& $ShouldDescend $child $State) }
            if ([bool]$child.is_directory -and -not [bool]$child.is_reparse -and $descend) {
                Invoke-FoundationHandleTreeDirectory -Root $Root -DirectoryPath ([string]$child.path) -DirectoryRelativePath ([string]$child.relative_path) -DirectoryHandle $child.handle -Visitor $Visitor -State $State -HeldHandlesSink $HeldHandlesSink -ShouldDescend $ShouldDescend
            }
        }
        $verificationBatch = Get-FoundationPinnedDirectoryChildren -TrustedRoot $Root -DirectoryPath $DirectoryPath -DirectoryHandle $DirectoryHandle -OpenMode immutable
        try {
            $verificationHandles = @($verificationBatch.entries)
            if ($verificationHandles.Count -ne $childHandles.Count) { throw "PATH_IDENTITY_CHANGED:$DirectoryPath" }
            $expectedChildren = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([System.StringComparer]::OrdinalIgnoreCase)
            foreach ($child in @($childHandles)) { $expectedChildren.Add([string]$child.name, $child) }
            foreach ($observedChild in @($verificationHandles)) {
                $observedName = [string]$observedChild.name
                if (-not $expectedChildren.ContainsKey($observedName)) { throw "PATH_IDENTITY_CHANGED:$DirectoryPath" }
                $expectedChild = $expectedChildren[$observedName]
                if ([string]$observedChild.info.VolumeSerial -cne [string]$expectedChild.info.VolumeSerial -or
                    [string]$observedChild.info.FileId -cne [string]$expectedChild.info.FileId -or
                    [uint32]$observedChild.info.Attributes -ne [uint32]$expectedChild.info.Attributes) {
                    throw "PATH_IDENTITY_CHANGED:$($observedChild.path)"
                }
            }
        }
        finally {
            foreach ($verifiedChild in @($verificationBatch.entries)) { if ($null -ne $verifiedChild.handle) { $verifiedChild.handle.Dispose() } }
        }
    }
    finally {
        foreach ($child in @($childHandles)) { if ($null -ne $child.handle) { $child.handle.Dispose() } }
    }
}

function Invoke-FoundationHandleTreeWalk {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][scriptblock]$Visitor,
        $State,
        $HeldHandlesSink = $null,
        $ShouldDescend = $null,
        [AllowNull()]$PathSecurityState = $null,
        [AllowNull()][string]$PathOperationId = $null,
        [ValidateSet("runtime_source_read", "runtime_snapshot_read", "manifest_read")]
        [string]$PathOperationKind = "manifest_read"
    )
    Initialize-FoundationNativePathType
    $rootFull = ConvertTo-FoundationStrictLocalPath $Root
    $rootPins = New-FoundationPinnedPathChain -Path $rootFull -ShareWrite $false -AllowMissing $false
    $rootHandle = $null
    $operationSucceeded = $false
    $operationError = $null
    try {
        $rootHandle = [FoundationValidationNativePath]::OpenImmutableRead($rootFull)
        Invoke-FoundationHandleTreeDirectory -Root $rootFull -DirectoryPath $rootFull -DirectoryRelativePath "" -DirectoryHandle $rootHandle -Visitor $Visitor -State $State -HeldHandlesSink $HeldHandlesSink -ShouldDescend $ShouldDescend
        $operationSucceeded = $true
    }
    catch {
        $operationError = Get-FoundationPathOperationErrorCode $_.Exception.ToString()
        throw
    }
    finally {
        if ($null -ne $PathSecurityState -and -not [string]::IsNullOrWhiteSpace($PathOperationId) -and -not $PathSecurityState.operation_ids.Contains($PathOperationId)) {
            [void](Add-FoundationPathSecurityOperation -State $PathSecurityState -OperationId $PathOperationId -OperationKind $PathOperationKind -Phase "complete" -PinnedPaths @($rootPins.pins) -Succeeded $operationSucceeded -ErrorCode $operationError)
        }
        if ($null -ne $rootHandle) { $rootHandle.Dispose() }
        Close-FoundationPinSet $rootPins
    }
}

function Get-FoundationNodeArchiveSidecarExpectation {
    param([Parameter(Mandatory = $true)]$Runtime)
    $production = Get-FoundationProductionLayoutConstants (Get-FoundationSelfProjectRoot)
    if (-not (Test-FoundationPathEqual ([string]$Runtime.dependency_source_roots.node_root) ([string]$production.dependency_source_roots.node_root))) {
        return $null
    }
    return [pscustomobject][ordered]@{
        relative_path = $script:FoundationNodeArchiveRelativePath
        content_root_relative_path = "node-v24.15.0-win-x64"
        length = [long]$script:FoundationNodeArchiveLength
        sha256 = $script:FoundationNodeArchiveSha256
        error_code = "RUNTIME_IDENTITY_INVALID:node_archive_sidecar"
    }
}

function Test-FoundationExcludedOrdinaryFileEntry {
    param([Parameter(Mandatory = $true)]$Entry, [Parameter(Mandatory = $true)]$State)
    $expected = $State.excluded_ordinary_file
    if ($null -eq $expected) { return $false }
    $relative = [string]$Entry.relative_path
    if (-not $relative.Equals([string]$expected.relative_path, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
    $errorCode = [string]$expected.error_code
    if ([bool]$State.excluded_ordinary_file_seen -or [bool]$Entry.is_directory -or [bool]$Entry.is_reparse -or
        [long]$Entry.info.Length -ne [long]$expected.length -or
        [FoundationValidationNativePath]::Sha256($Entry.handle) -cne ([string]$expected.sha256).ToUpperInvariant()) {
        throw $errorCode
    }
    $State.excluded_ordinary_file_seen = $true
    return $true
}

function Assert-FoundationExcludedOrdinaryFileSeen {
    param([Parameter(Mandatory = $true)]$State)
    if ($null -ne $State.excluded_ordinary_file -and -not [bool]$State.excluded_ordinary_file_seen) {
        throw ([string]$State.excluded_ordinary_file.error_code)
    }
}

function Get-FoundationCanonicalTreeIdentity {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][ValidateSet("source", "snapshot")][string]$Mode,
        $HeldHandlesSink = $null,
        $ExcludedOrdinaryFile = $null
    )
    Initialize-FoundationNativePathType
    $rootFull = ConvertTo-FoundationStrictLocalPath $Root
    $state = [pscustomobject]@{
        root = $rootFull
        mode = $Mode
        rows = (New-Object 'System.Collections.Generic.List[string]')
        relative_paths = (New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase))
        total_bytes = [long]0
        file_count = 0
        reparse_count = 0
        held_handles = $HeldHandlesSink
        excluded_ordinary_file = $ExcludedOrdinaryFile
        excluded_ordinary_file_seen = $false
    }
    $visitor = {
        param($Entry, $State)
        if (Test-FoundationExcludedOrdinaryFileEntry -Entry $Entry -State $State) { return }
        $relative = [string]$Entry.relative_path
        if ($relative -match '[|\r\n]' -or [string]::IsNullOrWhiteSpace($relative)) {
            throw "RUNTIME_IDENTITY_INVALID: invalid canonical relative path"
        }
        if (-not $State.relative_paths.Add($relative)) { throw "RUNTIME_IDENTITY_INVALID: case-insensitive path collision" }
        if ([bool]$Entry.is_reparse) {
            if (-not [bool]$Entry.is_directory) { throw "RUNTIME_IDENTITY_INVALID: only junction directories are allowed" }
            if ($null -ne $State.held_handles) { [void]$State.held_handles.Add([FoundationValidationNativePath]::DuplicatePinnedHandle($Entry.handle)) }
            $target = ConvertTo-FoundationStrictLocalPath ([FoundationValidationNativePath]::GetJunctionTarget($Entry.handle))
            if (-not (Test-FoundationPathContained -Parent ([string]$State.root) -Candidate $target)) {
                throw "RUNTIME_IDENTITY_INVALID: junction target escaped root"
            }
            $targetPins = New-FoundationPinnedPathChain -Path $target -ShareWrite $false -AllowMissing $false
            Close-FoundationPinSet $targetPins
            if ([string]$State.mode -ceq "source") {
                [void]$State.rows.Add("R|$relative|JUNCTION|$target")
            }
            else {
                $targetRelative = (Get-FoundationRelativePath ([string]$State.root) $target).Replace("/", "\")
                [void]$State.rows.Add("R|$relative|JUNCTION|@ROOT\$targetRelative")
            }
            $State.reparse_count = [int]$State.reparse_count + 1
            return
        }
        if ([bool]$Entry.is_directory) { return }
        if ($null -ne $State.held_handles) { [void]$State.held_handles.Add([FoundationValidationNativePath]::DuplicatePinnedHandle($Entry.handle)) }
        $hash = [FoundationValidationNativePath]::Sha256($Entry.handle)
        [void]$State.rows.Add("F|$relative|$($Entry.info.Length)|$hash")
        $State.file_count = [int]$State.file_count + 1
        $State.total_bytes = [long]$State.total_bytes + [long]$Entry.info.Length
    }
    Invoke-FoundationHandleTreeWalk -Root $rootFull -Visitor $visitor -State $state -HeldHandlesSink $HeldHandlesSink
    Assert-FoundationExcludedOrdinaryFileSeen -State $state
    $state.rows.Sort([System.StringComparer]::OrdinalIgnoreCase)
    return [pscustomobject][ordered]@{
        root = $rootFull
        canonical_tree_version = if ($Mode -ceq "source") { "canonical-tree-v1" } else { "canonical-tree-v2" }
        file_count = [int]$state.file_count
        reparse_count = [int]$state.reparse_count
        total_bytes = [long]$state.total_bytes
        canonical_line_count = $state.rows.Count
        tree_sha256 = Get-FoundationSha256Text (@($state.rows) -join "`n")
    }
}

function Assert-FoundationCanonicalTreeExpectation {
    param($Actual, $Expected, [string]$Label)
    if ($null -eq $Expected) { throw "RUNTIME_IDENTITY_INVALID:${Label}:expectation_missing" }
    foreach ($name in @("file_count", "reparse_count", "total_bytes", "canonical_line_count")) {
        $property = $Expected.PSObject.Properties[$name]
        if ($null -ne $property -and [long]$Actual.$name -ne [long]$property.Value) {
            throw "RUNTIME_IDENTITY_INVALID:${Label}:$name"
        }
    }
    $expectedHash = [string](Get-FoundationObjectValue $Expected "tree_sha256")
    if ([string]::IsNullOrWhiteSpace($expectedHash)) {
        $expectedHash = [string](Get-FoundationObjectValue $Expected "canonical_tree_v1_sha256")
    }
    if ([string]::IsNullOrWhiteSpace($expectedHash)) {
        $expectedHash = [string](Get-FoundationObjectValue $Expected "canonical_tree_v2_sha256")
    }
    if ([string]::IsNullOrWhiteSpace($expectedHash) -or [string]$Actual.tree_sha256 -cne $expectedHash.ToUpperInvariant()) {
        throw "RUNTIME_IDENTITY_INVALID:${Label}:tree_sha256"
    }
}

function Get-FoundationOrdinaryClosureTreeIdentity {
    param([Parameter(Mandatory = $true)][string]$Root)
    $rootFull = ConvertTo-FoundationStrictLocalPath $Root
    $state = [pscustomobject]@{
        rows = (New-Object 'System.Collections.Generic.List[string]')
        relative_paths = (New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase))
        file_count = 0
        total_bytes = [long]0
    }
    $visitor = {
        param($Entry, $State)
        $relative = [string]$Entry.relative_path
        if ($relative -match '[|\r\n]' -or -not $State.relative_paths.Add($relative)) { throw "RUNTIME_MODULE_CLOSURE_INVALID:path" }
        if ([bool]$Entry.is_reparse) { throw "RUNTIME_MODULE_CLOSURE_INVALID:reparse" }
        if ([bool]$Entry.is_directory) { return }
        $hash = [FoundationValidationNativePath]::Sha256($Entry.handle)
        [void]$State.rows.Add("$relative|$($Entry.info.Length)|$hash")
        $State.file_count = [int]$State.file_count + 1
        $State.total_bytes = [long]$State.total_bytes + [long]$Entry.info.Length
    }
    Invoke-FoundationHandleTreeWalk -Root $rootFull -Visitor $visitor -State $state
    $state.rows.Sort([System.StringComparer]::OrdinalIgnoreCase)
    return [pscustomobject][ordered]@{
        root = $rootFull
        file_count = [int]$state.file_count
        total_bytes = [long]$state.total_bytes
        tree_sha256 = Get-FoundationSha256Text (@($state.rows) -join "`n")
    }
}

function New-FoundationPhaseScanContext {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("source_start", "snapshot_ready", "before_command", "after_command", "finally_before_cleanup", "source_final_after_cleanup")]
        [string]$Phase,
        [AllowNull()]$PathSecurityState = $null,
        [AllowNull()][string]$PathOperationPrefix = $null
    )
    return [pscustomobject][ordered]@{
        schema_version = "foundation-phase-scan-context/v1"
        phase = $Phase
        root_ledgers = (New-Object 'System.Collections.Generic.Dictionary[string,object]' ([System.StringComparer]::Ordinal))
        root_ids_by_path = (New-Object 'System.Collections.Generic.Dictionary[string,string]' ([System.StringComparer]::OrdinalIgnoreCase))
        path_security_state = $PathSecurityState
        path_operation_prefix = $PathOperationPrefix
        closed = $false
    }
}

function Assert-FoundationPhaseScanContextOpen {
    param([Parameter(Mandatory = $true)]$Context)
    if ([bool]$Context.closed -or $null -eq $Context.root_ledgers -or $null -eq $Context.root_ids_by_path) {
        throw "RUNTIME_IDENTITY_INVALID:phase_scan_context_closed"
    }
}

function Add-FoundationPhaseRootLedger {
    param(
        [Parameter(Mandatory = $true)]$Context,
        [Parameter(Mandatory = $true)]
        [ValidateSet("source_node", "source_pnpm", "snapshot_node", "snapshot_pnpm")]
        [string]$RootId,
        [Parameter(Mandatory = $true)][string]$Root,
        $HeldHandlesSink = $null,
        $ExcludedOrdinaryFile = $null
    )
    Assert-FoundationPhaseScanContextOpen $Context
    if ($Context.root_ledgers.ContainsKey($RootId)) {
        throw "RUNTIME_IDENTITY_INVALID:$($Context.phase):duplicate_phase_root:$RootId"
    }
    $rootFull = ConvertTo-FoundationStrictLocalPath $Root
    if ($Context.root_ids_by_path.ContainsKey($rootFull)) {
        throw "RUNTIME_IDENTITY_INVALID:$($Context.phase):phase_root_alias:$RootId"
    }
    $state = [pscustomobject]@{
        root = $rootFull
        entries = (New-Object 'System.Collections.Generic.List[object]')
        entries_by_relative_path = (New-Object 'System.Collections.Generic.Dictionary[string,object]' ([System.StringComparer]::OrdinalIgnoreCase))
        held_handles = $HeldHandlesSink
        excluded_ordinary_file = $ExcludedOrdinaryFile
        excluded_ordinary_file_seen = $false
    }
    $visitor = {
        param($Entry, $State)
        if (Test-FoundationExcludedOrdinaryFileEntry -Entry $Entry -State $State) { return }
        $relative = [string]$Entry.relative_path
        if ($relative -match '[|\r\n]' -or [string]::IsNullOrWhiteSpace($relative)) {
            throw "RUNTIME_IDENTITY_INVALID: invalid canonical relative path"
        }
        if ($State.entries_by_relative_path.ContainsKey($relative)) {
            throw "RUNTIME_IDENTITY_INVALID: case-insensitive path collision"
        }
        $entryKind = "directory"
        $length = [long]0
        $sha256 = $null
        $target = $null
        $targetRelative = $null
        if ([bool]$Entry.is_reparse) {
            if (-not [bool]$Entry.is_directory) { throw "RUNTIME_IDENTITY_INVALID: only junction directories are allowed" }
            $entryKind = "junction"
            if ($null -ne $State.held_handles) { [void]$State.held_handles.Add([FoundationValidationNativePath]::DuplicatePinnedHandle($Entry.handle)) }
            $target = ConvertTo-FoundationStrictLocalPath ([FoundationValidationNativePath]::GetJunctionTarget($Entry.handle))
            if (-not (Test-FoundationPathContained -Parent ([string]$State.root) -Candidate $target)) {
                throw "RUNTIME_IDENTITY_INVALID: junction target escaped root"
            }
            $targetPins = New-FoundationPinnedPathChain -Path $target -ShareWrite $false -AllowMissing $false
            Close-FoundationPinSet $targetPins
            $targetRelative = (Get-FoundationRelativePath ([string]$State.root) $target).Replace("/", "\")
        }
        elseif (-not [bool]$Entry.is_directory) {
            $entryKind = "file"
            if ($null -ne $State.held_handles) { [void]$State.held_handles.Add([FoundationValidationNativePath]::DuplicatePinnedHandle($Entry.handle)) }
            $length = [long]$Entry.info.Length
            $sha256 = [FoundationValidationNativePath]::Sha256($Entry.handle)
        }
        $observation = [pscustomobject][ordered]@{
            relative_path = $relative
            entry_kind = $entryKind
            length = $length
            sha256 = $sha256
            volume_serial = [string]$Entry.info.VolumeSerial
            file_id = [string]$Entry.info.FileId
            junction_target = $target
            junction_target_relative = $targetRelative
        }
        $State.entries_by_relative_path.Add($relative, $observation)
        $State.entries.Add($observation)
    }
    $pathOperationKind = if ($RootId -like "source_*") { "runtime_source_read" } else { "runtime_snapshot_read" }
    $pathOperationId = $null
    if ($null -ne $Context.path_security_state -and -not [string]::IsNullOrWhiteSpace([string]$Context.path_operation_prefix)) {
        $pathOperationId = [string]$Context.path_operation_prefix + ":" + $RootId
    }
    Invoke-FoundationHandleTreeWalk -Root $rootFull -Visitor $visitor -State $state -HeldHandlesSink $HeldHandlesSink -PathSecurityState $Context.path_security_state -PathOperationId $pathOperationId -PathOperationKind $pathOperationKind
    Assert-FoundationExcludedOrdinaryFileSeen -State $state
    $ledger = [pscustomobject][ordered]@{
        schema_version = "foundation-phase-root-ledger/v1"
        phase = [string]$Context.phase
        root_id = $RootId
        root = $rootFull
        entries = $state.entries
        entries_by_relative_path = $state.entries_by_relative_path
    }
    $Context.root_ledgers.Add($RootId, $ledger)
    $Context.root_ids_by_path.Add($rootFull, $RootId)
    return $ledger
}

function Get-FoundationPhaseRootLedger {
    param([Parameter(Mandatory = $true)]$Context, [Parameter(Mandatory = $true)][string]$RootId)
    Assert-FoundationPhaseScanContextOpen $Context
    if (-not $Context.root_ledgers.ContainsKey($RootId)) {
        throw "RUNTIME_IDENTITY_INVALID:$($Context.phase):phase_root_missing:$RootId"
    }
    return $Context.root_ledgers[$RootId]
}

function Get-FoundationPhaseLedgerProjectionRoot {
    param([Parameter(Mandatory = $true)]$Ledger, [Parameter(Mandatory = $true)][string]$Root)
    $rootFull = ConvertTo-FoundationStrictLocalPath $Root
    if ($rootFull.Equals([string]$Ledger.root, [System.StringComparison]::OrdinalIgnoreCase)) {
        return [pscustomobject][ordered]@{ root = $rootFull; prefix = "" }
    }
    if (-not (Test-FoundationPathContained -Parent ([string]$Ledger.root) -Candidate $rootFull)) {
        throw "RUNTIME_IDENTITY_INVALID:phase_ledger_subtree_outside_root"
    }
    $rootRelative = (Get-FoundationRelativePath ([string]$Ledger.root) $rootFull).Replace("/", "\")
    if ([string]::IsNullOrWhiteSpace($rootRelative) -or $rootRelative -ceq "." -or
        -not $Ledger.entries_by_relative_path.ContainsKey($rootRelative) -or
        [string]$Ledger.entries_by_relative_path[$rootRelative].entry_kind -cne "directory") {
        throw "RUNTIME_IDENTITY_INVALID:phase_ledger_subtree_not_ordinary"
    }
    return [pscustomobject][ordered]@{ root = $rootFull; prefix = $rootRelative + "\" }
}

function Get-FoundationCanonicalTreeIdentityFromLedger {
    param(
        [Parameter(Mandatory = $true)]$Ledger,
        [Parameter(Mandatory = $true)][ValidateSet("source", "snapshot")][string]$Mode,
        [AllowNull()][string]$Root = $null
    )
    $projectionRoot = if ([string]::IsNullOrWhiteSpace($Root)) {
        [pscustomobject][ordered]@{ root = [string]$Ledger.root; prefix = "" }
    }
    else {
        Get-FoundationPhaseLedgerProjectionRoot -Ledger $Ledger -Root $Root
    }
    $rows = New-Object 'System.Collections.Generic.List[string]'
    $relativePaths = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $fileCount = 0
    $reparseCount = 0
    $totalBytes = [long]0
    foreach ($entry in $Ledger.entries) {
        $ledgerRelative = [string]$entry.relative_path
        if (-not [string]::IsNullOrEmpty([string]$projectionRoot.prefix)) {
            if (-not $ledgerRelative.StartsWith([string]$projectionRoot.prefix, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
            $relative = $ledgerRelative.Substring(([string]$projectionRoot.prefix).Length)
        }
        else {
            $relative = $ledgerRelative
        }
        if ($relative -match '[|\r\n]' -or [string]::IsNullOrWhiteSpace($relative) -or -not $relativePaths.Add($relative)) {
            throw "RUNTIME_IDENTITY_INVALID: invalid canonical relative path"
        }
        if ([string]$entry.entry_kind -ceq "junction") {
            $target = [string]$entry.junction_target
            if (-not (Test-FoundationPathContained -Parent ([string]$projectionRoot.root) -Candidate $target)) {
                throw "RUNTIME_IDENTITY_INVALID: junction target escaped root"
            }
            if ($Mode -ceq "source") {
                $rows.Add("R|$relative|JUNCTION|$target")
            }
            else {
                $targetRelative = (Get-FoundationRelativePath ([string]$projectionRoot.root) $target).Replace("/", "\")
                $rows.Add("R|$relative|JUNCTION|@ROOT\$targetRelative")
            }
            $reparseCount++
        }
        elseif ([string]$entry.entry_kind -ceq "file") {
            $rows.Add("F|$relative|$([long]$entry.length)|$([string]$entry.sha256)")
            $fileCount++
            $totalBytes += [long]$entry.length
        }
    }
    $rows.Sort([System.StringComparer]::OrdinalIgnoreCase)
    return [pscustomobject][ordered]@{
        root = [string]$projectionRoot.root
        canonical_tree_version = if ($Mode -ceq "source") { "canonical-tree-v1" } else { "canonical-tree-v2" }
        file_count = [int]$fileCount
        reparse_count = [int]$reparseCount
        total_bytes = [long]$totalBytes
        canonical_line_count = $rows.Count
        tree_sha256 = Get-FoundationSha256Text (@($rows) -join "`n")
    }
}

function Get-FoundationOrdinaryClosureTreeIdentityFromLedger {
    param([Parameter(Mandatory = $true)]$Ledger, [Parameter(Mandatory = $true)][string]$Root)
    $projectionRoot = Get-FoundationPhaseLedgerProjectionRoot -Ledger $Ledger -Root $Root
    $rows = New-Object 'System.Collections.Generic.List[string]'
    $relativePaths = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $fileCount = 0
    $totalBytes = [long]0
    foreach ($entry in $Ledger.entries) {
        $ledgerRelative = [string]$entry.relative_path
        if (-not $ledgerRelative.StartsWith([string]$projectionRoot.prefix, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
        $relative = $ledgerRelative.Substring(([string]$projectionRoot.prefix).Length)
        if ($relative -match '[|\r\n]' -or -not $relativePaths.Add($relative)) { throw "RUNTIME_MODULE_CLOSURE_INVALID:path" }
        if ([string]$entry.entry_kind -ceq "junction") { throw "RUNTIME_MODULE_CLOSURE_INVALID:reparse" }
        if ([string]$entry.entry_kind -ceq "directory") { continue }
        $rows.Add("$relative|$([long]$entry.length)|$([string]$entry.sha256)")
        $fileCount++
        $totalBytes += [long]$entry.length
    }
    $rows.Sort([System.StringComparer]::OrdinalIgnoreCase)
    return [pscustomobject][ordered]@{
        root = [string]$projectionRoot.root
        file_count = [int]$fileCount
        total_bytes = [long]$totalBytes
        tree_sha256 = Get-FoundationSha256Text (@($rows) -join "`n")
    }
}

function Get-FoundationPhaseLedgerEntry {
    param([Parameter(Mandatory = $true)]$Ledger, [Parameter(Mandatory = $true)][string]$Path)
    $full = ConvertTo-FoundationStrictLocalPath $Path
    if (-not (Test-FoundationPathContained -Parent ([string]$Ledger.root) -Candidate $full)) {
        throw "RUNTIME_IDENTITY_INVALID:phase_ledger_leaf_outside_root"
    }
    $relative = (Get-FoundationRelativePath ([string]$Ledger.root) $full).Replace("/", "\")
    if ([string]::IsNullOrWhiteSpace($relative) -or $relative -ceq "." -or
        -not $Ledger.entries_by_relative_path.ContainsKey($relative)) {
        throw "RUNTIME_IDENTITY_INVALID:phase_ledger_leaf_missing"
    }
    return $Ledger.entries_by_relative_path[$relative]
}

function Assert-FoundationPhaseLedgerLeafExpectation {
    param(
        [Parameter(Mandatory = $true)]$Ledger,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Expected,
        [Parameter(Mandatory = $true)][string]$Label
    )
    try {
        $full = ConvertTo-FoundationStrictLocalPath $Path
        $entry = Get-FoundationPhaseLedgerEntry -Ledger $Ledger -Path $full
        $expectedLength = [long](Get-FoundationObjectValue $Expected "length")
        $expectedHash = [string](Get-FoundationObjectValue $Expected "sha256")
        if ([string]::IsNullOrWhiteSpace($expectedHash)) { $expectedHash = [string](Get-FoundationObjectValue $Expected "entry_sha256") }
        if ([string]$entry.entry_kind -cne "file" -or [long]$entry.length -ne $expectedLength -or
            [string]::IsNullOrWhiteSpace($expectedHash) -or [string]$entry.sha256 -cne $expectedHash.ToUpperInvariant()) {
            throw "RUNTIME_IDENTITY_INVALID:$Label"
        }
        return [pscustomobject][ordered]@{
            path = $full
            length = [long]$entry.length
            sha256 = [string]$entry.sha256
            volume_serial = [string]$entry.volume_serial
            file_id = [string]$entry.file_id
        }
    }
    catch {
        if ($_.Exception.Message -match [regex]::Escape("RUNTIME_IDENTITY_INVALID:$Label")) { throw }
        throw "RUNTIME_IDENTITY_INVALID:$Label"
    }
}

function Close-FoundationPhaseScanContext {
    param($Context)
    if ($null -eq $Context -or [bool]$Context.closed) { return }
    try { $Context.root_ledgers.Clear() } catch { }
    try { $Context.root_ids_by_path.Clear() } catch { }
    $Context.closed = $true
}

function Close-FoundationHandleCollection {
    param($Handles)
    if ($null -eq $Handles) { return }
    for ($index = $Handles.Count - 1; $index -ge 0; $index--) {
        try { if ($null -ne $Handles[$index]) { $Handles[$index].Dispose() } } catch { }
    }
    try { $Handles.Clear() } catch { }
}

function Get-FoundationLivePinnedInputCount {
    param(
        $Handles = $null,
        $AdditionalHandles = $null,
        $PolicyModule = $null
    )
    $count = 0
    foreach ($handle in @($Handles) + @($AdditionalHandles)) {
        if ($null -ne $handle -and -not $handle.IsClosed) { $count++ }
    }
    if ($null -ne $PolicyModule) {
        if ($null -ne $PolicyModule.pin_handle -and -not $PolicyModule.pin_handle.IsClosed) { $count++ }
        if ($null -ne $PolicyModule.directory_pins) {
            $count += @($PolicyModule.directory_pins.pins | Where-Object { $null -ne $_.handle -and -not $_.handle.IsClosed }).Count
        }
    }
    return [int]$count
}

function Assert-FoundationPinnedLeafExpectation {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Expected,
        [Parameter(Mandatory = $true)][string]$Label,
        $HeldHandlesSink = $null
    )
    $full = ConvertTo-FoundationStrictLocalPath $Path
    $pins = New-FoundationPinnedPathChain -Path $full -ShareWrite $false -AllowMissing $false
    $handle = $null
    try {
        $handle = [FoundationValidationNativePath]::OpenImmutableRead($full)
        $info = [FoundationValidationNativePath]::GetInfo($handle)
        $final = ConvertFrom-FoundationFinalHandlePath ([string]$info.FinalPath)
        $expectedLength = [long](Get-FoundationObjectValue $Expected "length")
        $expectedHash = [string](Get-FoundationObjectValue $Expected "sha256")
        if ([string]::IsNullOrWhiteSpace($expectedHash)) { $expectedHash = [string](Get-FoundationObjectValue $Expected "entry_sha256") }
        if (($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0 -or
            ($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0 -or
            -not $final.Equals($full, [System.StringComparison]::OrdinalIgnoreCase) -or
            [long]$info.Length -ne $expectedLength -or [FoundationValidationNativePath]::Sha256($handle) -cne $expectedHash.ToUpperInvariant()) {
            throw "RUNTIME_IDENTITY_INVALID:$Label"
        }
        if ($null -ne $HeldHandlesSink) {
            [void]$HeldHandlesSink.Add($handle)
            $handle = $null
        }
        return [pscustomobject][ordered]@{ path = $full; length = [long]$info.Length; sha256 = $expectedHash.ToUpperInvariant(); volume_serial = [string]$info.VolumeSerial; file_id = [string]$info.FileId }
    }
    finally {
        if ($null -ne $handle) { $handle.Dispose() }
        Close-FoundationPinSet $pins
    }
}

function Copy-FoundationRuntimeTree {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][bool]$AllowJunctions,
        $ExcludedOrdinaryFile = $null,
        [AllowNull()]$PathSecurityState = $null,
        [AllowNull()][string]$PathOperationId = $null
    )
    Initialize-FoundationNativePathType
    $sourceFull = ConvertTo-FoundationStrictLocalPath $Source
    $destinationFull = ConvertTo-FoundationStrictLocalPath $Destination
    $sourceRootPins = New-FoundationPinnedPathChain -Path $sourceFull -ShareWrite $false -AllowMissing $false
    $destinationRootPins = New-FoundationPinnedDirectory -Path $destinationFull -OperationId ("directory:" + [string]$PathOperationId)
    $operationSucceeded = $false
    $operationError = $null
    try {
        $copyState = [pscustomobject]@{
            source_root = $sourceFull
            destination_root = $destinationFull
            allow_junctions = $AllowJunctions
            excluded_ordinary_file = $ExcludedOrdinaryFile
            excluded_ordinary_file_seen = $false
        }
        $copyVisitor = {
            param($Entry, $State)
            if (Test-FoundationExcludedOrdinaryFileEntry -Entry $Entry -State $State) { return }
            $destinationLeaf = Join-FoundationValidatedRelativePath -Root ([string]$State.destination_root) -RelativePath ([string]$Entry.relative_path)
            if (-not [bool]$Entry.is_reparse) {
                if ([bool]$Entry.is_directory) {
                    $pins = New-FoundationPinnedDirectory -Path $destinationLeaf -OperationId "runtime_snapshot_directory"
                    Close-FoundationPinSet $pins
                    return
                }
                Copy-FoundationPinnedHandleFile -SourceHandle $Entry.handle -SourceInfo $Entry.info -Destination $destinationLeaf
                return
            }
            if (-not [bool]$State.allow_junctions) { throw "RUNTIME_IDENTITY_INVALID: node source reparse entry" }
            if (-not [bool]$Entry.is_directory) { throw "RUNTIME_IDENTITY_INVALID: non-junction runtime reparse entry" }
            $destinationHandle = $null
            $destinationParentPins = $null
            try {
                $sourceTarget = ConvertTo-FoundationStrictLocalPath ([FoundationValidationNativePath]::GetJunctionTarget($Entry.handle))
                if (-not (Test-FoundationPathContained -Parent ([string]$State.source_root) -Candidate $sourceTarget)) {
                    throw "RUNTIME_IDENTITY_INVALID: source junction target escaped root"
                }
                $sourceTargetPins = New-FoundationPinnedPathChain -Path $sourceTarget -ShareWrite $false -AllowMissing $false
                Close-FoundationPinSet $sourceTargetPins
                $targetRelative = Get-FoundationRelativePath ([string]$State.source_root) $sourceTarget
                $destinationTarget = Join-FoundationValidatedRelativePath -Root ([string]$State.destination_root) -RelativePath $targetRelative
                if (-not (Test-FoundationPathContained -Parent ([string]$State.destination_root) -Candidate $destinationTarget)) {
                    throw "RUNTIME_IDENTITY_INVALID: rewritten junction target escaped snapshot"
                }
                $destinationParentPins = New-FoundationPinnedDirectory -Path (Get-FoundationLexicalParentPath $destinationLeaf) -OperationId "runtime_snapshot_junction_parent"
                [FoundationValidationNativePath]::CreateDirectoryExact($destinationLeaf)
                $destinationHandle = [FoundationValidationNativePath]::OpenWritableReparseDirectory($destinationLeaf)
                [FoundationValidationNativePath]::SetJunctionTarget($destinationHandle, $destinationTarget)
                $actualTarget = ConvertTo-FoundationStrictLocalPath ([FoundationValidationNativePath]::GetJunctionTarget($destinationHandle))
                if (-not $actualTarget.Equals($destinationTarget, [System.StringComparison]::OrdinalIgnoreCase)) {
                    throw "PATH_OPERATION_FAILED: snapshot junction verification"
                }
            }
            finally {
                if ($null -ne $destinationHandle) { $destinationHandle.Dispose() }
                Close-FoundationPinSet $destinationParentPins
            }
        }
        Invoke-FoundationHandleTreeWalk -Root $sourceFull -Visitor $copyVisitor -State $copyState
        Assert-FoundationExcludedOrdinaryFileSeen -State $copyState
        $operationSucceeded = $true
    }
    catch {
        $operationError = Get-FoundationPathOperationErrorCode $_.Exception.ToString()
        throw
    }
    finally {
        if ($null -ne $PathSecurityState -and -not [string]::IsNullOrWhiteSpace($PathOperationId) -and -not $PathSecurityState.operation_ids.Contains($PathOperationId)) {
            [void](Add-FoundationPathSecurityOperation -State $PathSecurityState -OperationId $PathOperationId -OperationKind "runtime_snapshot_create" -Phase "complete" -PinnedPaths (@($sourceRootPins.pins) + @($destinationRootPins.pins)) -Succeeded $operationSucceeded -ErrorCode $operationError)
        }
        Close-FoundationPinSet $destinationRootPins
        Close-FoundationPinSet $sourceRootPins
    }
}

function New-FoundationRuntimeSnapshot {
    param($Layout, $Runtime, $SnapshotIdentity, [AllowNull()]$PathSecurityState = $null)
    $sourceTrees = Get-FoundationObjectValue $Runtime.identity_expectations "source_trees"
    $snapshotTrees = Get-FoundationObjectValue $Runtime.identity_expectations "snapshot_trees"
    $nodeArchive = Get-FoundationNodeArchiveSidecarExpectation -Runtime $Runtime
    $sourceNodePhysicalRoot = ConvertTo-FoundationStrictLocalPath ([string]$Runtime.dependency_source_roots.node_root)
    $sourceNodeContentRoot = $sourceNodePhysicalRoot
    if ($null -ne $nodeArchive) {
        $sourceNodeContentRoot = Join-FoundationValidatedChildPath -Parent $sourceNodePhysicalRoot -Name ([string]$nodeArchive.content_root_relative_path)
    }
    $sourceNode = Get-FoundationCanonicalTreeIdentity -Root $sourceNodeContentRoot -Mode source
    $sourceNode.root = $sourceNodePhysicalRoot
    $sourcePnpm = Get-FoundationCanonicalTreeIdentity -Root ([string]$Runtime.dependency_source_roots.pnpm_root) -Mode source
    Assert-FoundationCanonicalTreeExpectation $sourceNode (Get-FoundationObjectValue $sourceTrees "node") "source_node"
    Assert-FoundationCanonicalTreeExpectation $sourcePnpm (Get-FoundationObjectValue $sourceTrees "pnpm") "source_pnpm"
    $snapshotPins = New-FoundationPinnedDirectory -Path ([string]$SnapshotIdentity.root) -OperationId "runtime_snapshot_root"
    Close-FoundationPinSet $snapshotPins
    Copy-FoundationRuntimeTree -Source ([string]$Runtime.dependency_source_roots.node_root) -Destination ([string]$SnapshotIdentity.node_root) -AllowJunctions $false -ExcludedOrdinaryFile $nodeArchive -PathSecurityState $PathSecurityState -PathOperationId "runtime_snapshot_create:node"
    Copy-FoundationRuntimeTree -Source ([string]$Runtime.dependency_source_roots.pnpm_root) -Destination ([string]$SnapshotIdentity.pnpm_root) -AllowJunctions $true -PathSecurityState $PathSecurityState -PathOperationId "runtime_snapshot_create:pnpm"
    $snapshotNodePhysicalRoot = ConvertTo-FoundationStrictLocalPath ([string]$SnapshotIdentity.node_root)
    $snapshotNodeContentRoot = $snapshotNodePhysicalRoot
    if ($null -ne $nodeArchive) {
        $snapshotNodeContentRoot = Join-FoundationValidatedChildPath -Parent $snapshotNodePhysicalRoot -Name ([string]$nodeArchive.content_root_relative_path)
    }
    $snapshotNode = Get-FoundationCanonicalTreeIdentity -Root $snapshotNodeContentRoot -Mode snapshot
    $snapshotNode.root = $snapshotNodePhysicalRoot
    $snapshotPnpm = Get-FoundationCanonicalTreeIdentity -Root ([string]$SnapshotIdentity.pnpm_root) -Mode snapshot
    Assert-FoundationCanonicalTreeExpectation $snapshotNode (Get-FoundationObjectValue $snapshotTrees "node") "snapshot_node"
    Assert-FoundationCanonicalTreeExpectation $snapshotPnpm (Get-FoundationObjectValue $snapshotTrees "pnpm") "snapshot_pnpm"
    foreach ($path in @($SnapshotIdentity.node_entry, $SnapshotIdentity.vitest_entry, $SnapshotIdentity.typescript_entry, $SnapshotIdentity.openclaw_entry)) {
        $pins = New-FoundationPinnedPathChain -Path ([string]$path) -ShareWrite $false -AllowMissing $false
        Close-FoundationPinSet $pins
    }
    return [pscustomobject][ordered]@{ source = [pscustomobject]@{ node = $sourceNode; pnpm = $sourcePnpm }; snapshot = [pscustomobject]@{ node = $snapshotNode; pnpm = $snapshotPnpm }; verified = $true }
}

function Add-FoundationPinnedOrdinaryLeaf {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)]$Sink, [string]$Label = "input")
    $full = ConvertTo-FoundationStrictLocalPath $Path
    $pins = New-FoundationPinnedPathChain -Path $full -ShareWrite $false -AllowMissing $false
    $handle = $null
    try {
        $handle = [FoundationValidationNativePath]::OpenImmutableRead($full)
        $info = [FoundationValidationNativePath]::GetInfo($handle)
        $final = ConvertFrom-FoundationFinalHandlePath ([string]$info.FinalPath)
        if (($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0 -or
            ($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0 -or
            -not $final.Equals($full, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "RUNTIME_IDENTITY_INVALID:$Label"
        }
        $hash = [FoundationValidationNativePath]::Sha256($handle)
        [void]$Sink.Add($handle)
        $handle = $null
        return [pscustomobject][ordered]@{ path = $full; length = [long]$info.Length; sha256 = $hash; volume_serial = [string]$info.VolumeSerial; file_id = [string]$info.FileId }
    }
    finally {
        if ($null -ne $handle) { $handle.Dispose() }
        Close-FoundationPinSet $pins
    }
}

function Assert-FoundationOrdinaryDirectoryPath {
    param([Parameter(Mandatory = $true)][string]$Path, [string]$Label = "directory")
    $full = ConvertTo-FoundationStrictLocalPath $Path
    $pins = New-FoundationPinnedPathChain -Path $full -ShareWrite $false -AllowMissing $false
    $handle = $null
    try {
        $handle = [FoundationValidationNativePath]::OpenImmutableRead($full)
        $info = [FoundationValidationNativePath]::GetInfo($handle)
        $final = ConvertFrom-FoundationFinalHandlePath ([string]$info.FinalPath)
        if (($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -eq 0 -or
            ($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0 -or
            -not $final.Equals($full, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "RUNTIME_IDENTITY_INVALID:$Label"
        }
    }
    finally {
        if ($null -ne $handle) { $handle.Dispose() }
        Close-FoundationPinSet $pins
    }
}

function Get-FoundationStagingTreeIdentityPass {
    param([Parameter(Mandatory = $true)][string]$Root, $HeldHandlesSink = $null)
    $rootFull = ConvertTo-FoundationStrictLocalPath $Root
    $state = [pscustomobject]@{
        rows = (New-Object 'System.Collections.Generic.List[string]')
        non_dist_rows = (New-Object 'System.Collections.Generic.List[string]')
        relative_paths = (New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase))
        file_count = 0
        directory_count = 0
        total_bytes = [long]0
        non_dist_file_count = 0
        non_dist_directory_count = 0
        non_dist_total_bytes = [long]0
        dist_entry_count = 0
        held_handles = $HeldHandlesSink
    }
    $visitor = {
        param($Entry, $State)
        $relative = [string]$Entry.relative_path
        if ([string]::IsNullOrWhiteSpace($relative) -or $relative -match '[|\r\n]' -or -not $State.relative_paths.Add($relative)) {
            throw "RUNTIME_IDENTITY_INVALID:staging_path"
        }
        if (([string]$Entry.name).StartsWith(".env", [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "RUNTIME_IDENTITY_INVALID:staging_environment_file"
        }
        if ([bool]$Entry.is_reparse) { throw "RUNTIME_IDENTITY_INVALID:staging_reparse" }
        $isDistEntry = $relative.Equals("dist", [System.StringComparison]::OrdinalIgnoreCase) -or
            $relative.StartsWith("dist\", [System.StringComparison]::OrdinalIgnoreCase)
        if ([bool]$Entry.is_directory) {
            $row = "D|$relative"
            [void]$State.rows.Add($row)
            $State.directory_count = [int]$State.directory_count + 1
            if ($isDistEntry) { $State.dist_entry_count = [int]$State.dist_entry_count + 1 }
            else {
                [void]$State.non_dist_rows.Add($row)
                $State.non_dist_directory_count = [int]$State.non_dist_directory_count + 1
            }
            return
        }
        $hash = [FoundationValidationNativePath]::Sha256($Entry.handle)
        $row = "F|$relative|$($Entry.info.Length)|$hash"
        [void]$State.rows.Add($row)
        $State.file_count = [int]$State.file_count + 1
        $State.total_bytes = [long]$State.total_bytes + [long]$Entry.info.Length
        if ($isDistEntry) { $State.dist_entry_count = [int]$State.dist_entry_count + 1 }
        else {
            [void]$State.non_dist_rows.Add($row)
            $State.non_dist_file_count = [int]$State.non_dist_file_count + 1
            $State.non_dist_total_bytes = [long]$State.non_dist_total_bytes + [long]$Entry.info.Length
        }
        if ($null -ne $State.held_handles) { [void]$State.held_handles.Add([FoundationValidationNativePath]::DuplicatePinnedHandle($Entry.handle)) }
    }
    Invoke-FoundationHandleTreeWalk -Root $rootFull -Visitor $visitor -State $state -HeldHandlesSink $HeldHandlesSink
    $state.rows.Sort([System.StringComparer]::OrdinalIgnoreCase)
    $state.non_dist_rows.Sort([System.StringComparer]::OrdinalIgnoreCase)
    return [pscustomobject][ordered]@{
        schema_version = "staging-tree-v1"
        root = $rootFull
        file_count = [int]$state.file_count
        directory_count = [int]$state.directory_count
        total_bytes = [long]$state.total_bytes
        canonical_line_count = [int]$state.rows.Count
        tree_sha256 = Get-FoundationSha256Text (@($state.rows) -join "`n")
        non_dist_tree = [pscustomobject][ordered]@{
            file_count = [int]$state.non_dist_file_count
            directory_count = [int]$state.non_dist_directory_count
            total_bytes = [long]$state.non_dist_total_bytes
            canonical_line_count = [int]$state.non_dist_rows.Count
            tree_sha256 = Get-FoundationSha256Text (@($state.non_dist_rows) -join "`n")
        }
        dist_entry_count = [int]$state.dist_entry_count
    }
}

function Get-FoundationStagingTreeIdentity {
    param([Parameter(Mandatory = $true)][string]$Root, $HeldHandlesSink = $null)
    $ownedFirstPassHandles = $null
    $firstPassSink = $HeldHandlesSink
    $secondPassHandles = New-Object System.Collections.ArrayList
    if ($null -eq $firstPassSink) {
        $ownedFirstPassHandles = New-Object System.Collections.ArrayList
        $firstPassSink = $ownedFirstPassHandles
    }
    try {
        $firstPass = Get-FoundationStagingTreeIdentityPass -Root $Root -HeldHandlesSink $firstPassSink
        $secondPass = Get-FoundationStagingTreeIdentityPass -Root $Root -HeldHandlesSink $secondPassHandles
        $firstJson = [string]($firstPass | ConvertTo-Json -Depth 8 -Compress)
        $secondJson = [string]($secondPass | ConvertTo-Json -Depth 8 -Compress)
        if ($firstJson -cne $secondJson) { throw "RUNTIME_IDENTITY_INVALID:staging_tree_changed_during_scan" }
        return $firstPass
    }
    finally {
        Close-FoundationHandleCollection $secondPassHandles
        if ($null -ne $ownedFirstPassHandles) { Close-FoundationHandleCollection $ownedFirstPassHandles }
    }
}

function Assert-FoundationCommandInputIdentity {
    param($Actual, $Expected, [string]$CommandId, [bool]$AllowBuildOutput = $false)
    if ($null -eq $Actual -or $null -eq $Expected) { throw "RUNTIME_IDENTITY_INVALID:${CommandId}:command_input_missing" }
    if ($AllowBuildOutput) {
        if ([string]$Actual.schema_version -cne "staging-tree-v1" -or [string]$Expected.schema_version -cne "staging-tree-v1" -or
            -not ([string]$Actual.root).Equals([string]$Expected.root, [System.StringComparison]::OrdinalIgnoreCase) -or
            [int]$Expected.dist_entry_count -ne 0 -or $null -eq $Actual.non_dist_tree -or $null -eq $Expected.non_dist_tree) {
            throw "RUNTIME_IDENTITY_INVALID:${CommandId}:build_output_contract"
        }
        $actualNonDistJson = [string]($Actual.non_dist_tree | ConvertTo-Json -Depth 4 -Compress)
        $expectedNonDistJson = [string]($Expected.non_dist_tree | ConvertTo-Json -Depth 4 -Compress)
        if ($actualNonDistJson -cne $expectedNonDistJson) { throw "RUNTIME_IDENTITY_INVALID:${CommandId}:staging_tree_changed" }
        return
    }
    $actualJson = [string]($Actual | ConvertTo-Json -Depth 8 -Compress)
    $expectedJson = [string]($Expected | ConvertTo-Json -Depth 8 -Compress)
    if ($actualJson -cne $expectedJson) { throw "RUNTIME_IDENTITY_INVALID:${CommandId}:staging_tree_changed" }
}

function Add-FoundationCommandImmutableInputPins {
    param($Spec, $Runtime, [Parameter(Mandatory = $true)]$Sink)
    if ($null -eq $Spec) { return $null }
    if ([string]$Spec.id -ceq "A.structure") {
        $aExpected = Get-FoundationObjectValue $Runtime.identity_expectations "a_structure"
        $executableIdentity = Assert-FoundationPinnedLeafExpectation -Path ([string]$Spec.executable) -Expected $aExpected -Label "A_executable" -HeldHandlesSink $Sink
        $version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo((ConvertTo-FoundationStrictLocalPath ([string]$Spec.executable)))
        $expectedFileVersionValue = Get-FoundationObjectValue $aExpected "file_version"
        $expectedProductVersionValue = Get-FoundationObjectValue $aExpected "product_version"
        if (-not ($expectedFileVersionValue -is [string]) -or [string]::IsNullOrWhiteSpace([string]$expectedFileVersionValue) -or
            -not ($expectedProductVersionValue -is [string]) -or [string]::IsNullOrWhiteSpace([string]$expectedProductVersionValue)) {
            throw "RUNTIME_IDENTITY_INVALID:A_executable_version"
        }
        foreach ($expectedVersionValue in @($expectedFileVersionValue, $expectedProductVersionValue)) {
            $expectedVersionParts = @(([string]$expectedVersionValue).Split([char]'.'))
            if ($expectedVersionParts.Count -ne 4) { throw "RUNTIME_IDENTITY_INVALID:A_executable_version" }
            foreach ($expectedVersionPart in $expectedVersionParts) {
                $parsedVersionPart = [uint32]0
                if ([string]::IsNullOrEmpty([string]$expectedVersionPart) -or
                    -not [uint32]::TryParse([string]$expectedVersionPart, [System.Globalization.NumberStyles]::None, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$parsedVersionPart)) {
                    throw "RUNTIME_IDENTITY_INVALID:A_executable_version"
                }
            }
        }
        $actualFileVersion = [string]::Join(".", [string[]]@(
            ([int]$version.FileMajorPart).ToString([System.Globalization.CultureInfo]::InvariantCulture),
            ([int]$version.FileMinorPart).ToString([System.Globalization.CultureInfo]::InvariantCulture),
            ([int]$version.FileBuildPart).ToString([System.Globalization.CultureInfo]::InvariantCulture),
            ([int]$version.FilePrivatePart).ToString([System.Globalization.CultureInfo]::InvariantCulture)
        ))
        $actualProductVersionValue = $version.ProductVersion
        if (-not ($actualProductVersionValue -is [string]) -or [string]::IsNullOrWhiteSpace([string]$actualProductVersionValue) -or
            $actualFileVersion -cne [string]$expectedFileVersionValue -or
            [string]$actualProductVersionValue -cne [string]$expectedProductVersionValue) {
            throw "RUNTIME_IDENTITY_INVALID:A_executable_version"
        }
        $scriptIdentity = Add-FoundationPinnedOrdinaryLeaf -Path ([string](Get-FoundationObjectValue $aExpected "script_path")) -Sink $Sink -Label "A_script"
        return [pscustomobject][ordered]@{ schema_version = "command-input-v1"; command_id = [string]$Spec.id; executable = $executableIdentity; script = $scriptIdentity }
    }
    if ([string]::IsNullOrWhiteSpace([string]$Spec.staging_root)) { throw "RUNTIME_IDENTITY_INVALID:staging_root" }
    return Get-FoundationStagingTreeIdentity -Root ([string]$Spec.staging_root) -HeldHandlesSink $Sink
}

function Get-FoundationFreshModuleClosureIdentity {
    param($Runtime, [string]$Phase, [Parameter(Mandatory = $true)]$PhaseScanContext)
    $expectations = Get-FoundationObjectValue $Runtime.identity_expectations "module_closure"
    $tools = Get-FoundationObjectValue $Runtime.identity_expectations "tools"
    $sourcePnpmLedger = Get-FoundationPhaseRootLedger -Context $PhaseScanContext -RootId "source_pnpm"
    $toolTrees = [ordered]@{}
    foreach ($name in @("vitest", "typescript", "openclaw")) {
        $toolExpected = Get-FoundationObjectValue $tools $name
        $actualTree = Get-FoundationCanonicalTreeIdentityFromLedger -Ledger $sourcePnpmLedger -Root ([string](Get-FoundationObjectValue $toolExpected "physical_target_path")) -Mode source
        Assert-FoundationCanonicalTreeExpectation $actualTree (Get-FoundationObjectValue $toolExpected "tree") ("${Phase}_${name}_closure_tree")
        $toolTrees[$name] = $actualTree
    }
    $typeboxExpected = Get-FoundationObjectValue $expectations "staging_typebox"
    $typeboxTree = Get-FoundationOrdinaryClosureTreeIdentityFromLedger -Ledger $sourcePnpmLedger -Root ([string]$Runtime.dependency_source_roots.typebox_root)
    if ([int]$typeboxTree.file_count -ne [int](Get-FoundationObjectValue $typeboxExpected "file_count") -or
        [long]$typeboxTree.total_bytes -ne [long](Get-FoundationObjectValue $typeboxExpected "total_bytes") -or
        [string]$typeboxTree.tree_sha256 -cne ([string](Get-FoundationObjectValue $typeboxExpected "tree_sha256")).ToUpperInvariant()) {
        throw "RUNTIME_MODULE_CLOSURE_INVALID:${Phase}:typebox_tree"
    }
    $packagePath = Join-FoundationValidatedChildPath -Parent (ConvertTo-FoundationStrictLocalPath ([string]$Runtime.dependency_source_roots.typebox_root)) -Name "package.json"
    try {
        $packageEntry = Get-FoundationPhaseLedgerEntry -Ledger $sourcePnpmLedger -Path $packagePath
        $expectedPackageHash = [string](Get-FoundationObjectValue $typeboxExpected "package_sha256")
        if ([string]$packageEntry.entry_kind -cne "file" -or [string]::IsNullOrWhiteSpace($expectedPackageHash) -or
            [string]$packageEntry.sha256 -cne $expectedPackageHash.ToUpperInvariant()) {
            throw "RUNTIME_MODULE_CLOSURE_INVALID:typebox_package"
        }
    }
    catch {
        if ($_.Exception.Message -match 'RUNTIME_MODULE_CLOSURE_INVALID:typebox_package') { throw }
        throw "RUNTIME_MODULE_CLOSURE_INVALID:typebox_package"
    }
    foreach ($name in @("vitest", "typescript", "openclaw", "staging_typebox")) {
        $entry = Get-FoundationObjectValue $expectations $name
        foreach ($field in @("reachable_packages", "manifest_edges", "required_gap_count", "c_top_edge_count", "missing_optional_peer_count")) {
            $value = [int](Get-FoundationObjectValue $entry $field)
            if ($value -lt 0) { throw "RUNTIME_MODULE_CLOSURE_INVALID:${name}:$field" }
        }
        if ([int](Get-FoundationObjectValue $entry "required_gap_count") -ne 0 -or
            [int](Get-FoundationObjectValue $entry "c_top_edge_count") -ne 0) {
            throw "RUNTIME_MODULE_CLOSURE_INVALID:$name"
        }
    }
    $closureClone = (($expectations | ConvertTo-Json -Depth 16 -Compress) | ConvertFrom-Json)
    return [pscustomobject][ordered]@{ closure = $closureClone; tool_trees = [pscustomobject]$toolTrees; staging_typebox_tree = $typeboxTree }
}

function Get-FoundationFreshNativeExecutionIdentity {
    param($Runtime, $SnapshotIdentity, [string]$Phase, [Parameter(Mandatory = $true)]$PhaseScanContext)
    $expected = Get-FoundationObjectValue $Runtime.identity_expectations "native_execution_allowlist"
    $actual = [ordered]@{}
    foreach ($name in @("snapshot_node_executable", "vitest_fork", "vitest_addon", "vitest_child")) {
        $leafExpected = Get-FoundationObjectValue $expected $name
        if ($null -eq $leafExpected) { throw "RUNTIME_NATIVE_CLOSURE_INVALID:${name}:expectation_missing" }
        $leafNames = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($leafName in @(Get-FoundationObjectNames $leafExpected)) {
            if (-not $leafNames.Add([string]$leafName)) { throw "RUNTIME_NATIVE_CLOSURE_INVALID:${name}:path_contract" }
        }
        $hasPath = $leafNames.Contains("path")
        $hasRelativePath = $leafNames.Contains("relative_path")
        if ($hasPath -eq $hasRelativePath) { throw "RUNTIME_NATIVE_CLOSURE_INVALID:${name}:path_contract" }

        if ($name -ceq "snapshot_node_executable") {
            $sourceRoot = ConvertTo-FoundationStrictLocalPath ([string]$Runtime.dependency_source_roots.node_root)
            $snapshotPrefix = "node\"
            $authoritativeSnapshotPath = ConvertTo-FoundationStrictLocalPath ([string]$SnapshotIdentity.node_entry)
            $sourceLedger = Get-FoundationPhaseRootLedger -Context $PhaseScanContext -RootId "source_node"
            $snapshotLedger = Get-FoundationPhaseRootLedger -Context $PhaseScanContext -RootId "snapshot_node"
        }
        else {
            $sourceRoot = ConvertTo-FoundationStrictLocalPath ([string]$Runtime.dependency_source_roots.pnpm_root)
            $snapshotPrefix = "pnpm\"
            $sourceLedger = Get-FoundationPhaseRootLedger -Context $PhaseScanContext -RootId "source_pnpm"
            $snapshotLedger = Get-FoundationPhaseRootLedger -Context $PhaseScanContext -RootId "snapshot_pnpm"
            if ($name -ceq "vitest_fork") { $authoritativeSnapshotPath = ConvertTo-FoundationStrictLocalPath ([string]$SnapshotIdentity.vitest_fork_entry) }
            elseif ($name -ceq "vitest_addon") { $authoritativeSnapshotPath = ConvertTo-FoundationStrictLocalPath ([string]$SnapshotIdentity.rollup_addon) }
            else { $authoritativeSnapshotPath = ConvertTo-FoundationStrictLocalPath ([string]$SnapshotIdentity.esbuild_entry) }
        }

        if ($hasPath) {
            $sourcePathValue = Get-FoundationObjectValue $leafExpected "path"
            if (-not ($sourcePathValue -is [string]) -or [string]::IsNullOrWhiteSpace([string]$sourcePathValue)) {
                throw "RUNTIME_NATIVE_CLOSURE_INVALID:${name}:path_contract"
            }
            $sourcePath = ConvertTo-FoundationStrictLocalPath ([string]$sourcePathValue)
            if (-not (Test-FoundationPathContained -Parent $sourceRoot -Candidate $sourcePath)) {
                throw "RUNTIME_NATIVE_CLOSURE_INVALID:${name}:source_path"
            }
            $sourceRelative = Get-FoundationRelativePath -Root $sourceRoot -Path $sourcePath
            if ([string]::IsNullOrWhiteSpace($sourceRelative) -or $sourceRelative -ceq ".") {
                throw "RUNTIME_NATIVE_CLOSURE_INVALID:${name}:source_root_not_leaf"
            }
            $relative = $snapshotPrefix + $sourceRelative
        }
        else {
            $relativeValue = Get-FoundationObjectValue $leafExpected "relative_path"
            if (-not ($relativeValue -is [string]) -or [string]::IsNullOrWhiteSpace([string]$relativeValue)) {
                throw "RUNTIME_NATIVE_CLOSURE_INVALID:${name}:path_contract"
            }
            $relative = [string]$relativeValue
            if (-not $relative.StartsWith($snapshotPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "RUNTIME_NATIVE_CLOSURE_INVALID:${name}:snapshot_prefix"
            }
            $sourceRelative = $relative.Substring($snapshotPrefix.Length)
            if ([string]::IsNullOrWhiteSpace($sourceRelative)) {
                throw "RUNTIME_NATIVE_CLOSURE_INVALID:${name}:source_root_not_leaf"
            }
            $sourcePath = Join-FoundationValidatedRelativePath -Root $sourceRoot -RelativePath $sourceRelative
        }

        $snapshotPath = Join-FoundationValidatedRelativePath -Root ([string]$SnapshotIdentity.root) -RelativePath $relative
        if (-not $snapshotPath.Equals($authoritativeSnapshotPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "RUNTIME_NATIVE_CLOSURE_INVALID:${name}:snapshot_path"
        }
        [void](Assert-FoundationPhaseLedgerLeafExpectation -Ledger $sourceLedger -Path $sourcePath -Expected $leafExpected -Label ("${Phase}_${name}_source"))
        $actual[$name] = Assert-FoundationPhaseLedgerLeafExpectation -Ledger $snapshotLedger -Path $snapshotPath -Expected $leafExpected -Label ("${Phase}_${name}_snapshot")
    }
    foreach ($name in @("typescript_native_count", "openclaw_plugin_native_count")) {
        $count = [int](Get-FoundationObjectValue $expected $name)
        if ($count -ne 0) { throw "RUNTIME_NATIVE_CLOSURE_INVALID:$name" }
        $actual[$name] = $count
    }
    return [pscustomobject]$actual
}

function Assert-FoundationRuntimeExecutionQuiescent {
    param($Commands, $Specs)
    $specMap = @{}
    foreach ($spec in @($Specs)) { $specMap[[string]$spec.id] = $spec }
    foreach ($command in @($Commands | Where-Object { [string]$_.status -cne "skipped" })) {
        if ($null -eq $command.finished_at -or $null -eq $command.job_control -or
            $null -eq $command.job_control.accounting -or [int]$command.job_control.accounting.active_processes -ne 0 -or
            -not [bool]$command.job_control.accounting.matched -or $null -eq $command.job_control.completion_telemetry -or
            -not [bool]$command.job_control.completion_telemetry.active_zero_observed) {
            throw "PROCESS_JOB_ACCOUNTING_MISMATCH:$($command.id)"
        }
        foreach ($descendant in @($command.job_control.completion_telemetry.messages | Where-Object { $null -ne $_.PSObject.Properties['exit_observed'] })) {
            if (-not [bool]$descendant.exit_observed) { throw "PROCESS_DESCENDANT_LEAK_PREVENTED:$($command.id)" }
        }
        $spec = $specMap[[string]$command.id]
        if ($null -ne $spec -and $null -ne $spec.node_runtime) { [void](Read-FoundationPhysicalPolicyJournal -Spec $spec -RunnerResult $command) }
    }
}

function New-FoundationRuntimeIdentityCheck {
    param(
        $Runtime,
        $SnapshotIdentity,
        [ValidateSet("source_start", "snapshot_ready", "before_command", "after_command", "finally_before_cleanup", "source_final_after_cleanup")][string]$Phase,
        [bool]$IncludeSnapshot,
        [AllowNull()][string]$CommandId = $null,
        $PolicyModule = $null,
        $RetainedHandles = $null,
        [bool]$RetainRuntimeInputs = $false,
        $CommandSpec = $null,
        $ExpectedCommandInputIdentity = $null,
        [bool]$RetainCommandInputs = $false,
        $CommandSpecs = @(),
        $CommandInputExpectations = $null,
        [bool]$AllowBuildOutput = $false,
        $Commands = @(),
        $Specs = @(),
        [bool]$RequireExecutionQuiescence = $false,
        [AllowNull()]$PathSecurityState = $null,
        [AllowNull()][string]$PathOperationPrefix = $null
    )
    $ownedHandles = $null
    $transientCommandHandles = $null
    $phaseScanContext = $null
    if ($null -eq $RetainedHandles) { $ownedHandles = New-Object System.Collections.ArrayList; $RetainedHandles = $ownedHandles; $RetainRuntimeInputs = $true }
    try {
        $sourceTrees = Get-FoundationObjectValue $Runtime.identity_expectations "source_trees"
        $snapshotTrees = Get-FoundationObjectValue $Runtime.identity_expectations "snapshot_trees"
        $runtimeSink = if ($RetainRuntimeInputs) { $RetainedHandles } else { $null }
        $phaseScanContext = New-FoundationPhaseScanContext -Phase $Phase -PathSecurityState $PathSecurityState -PathOperationPrefix $PathOperationPrefix
        $nodeArchive = Get-FoundationNodeArchiveSidecarExpectation -Runtime $Runtime
        $sourceNodeLedger = Add-FoundationPhaseRootLedger -Context $phaseScanContext -RootId "source_node" -Root ([string]$Runtime.dependency_source_roots.node_root) -HeldHandlesSink $runtimeSink -ExcludedOrdinaryFile $nodeArchive
        $sourcePnpmLedger = Add-FoundationPhaseRootLedger -Context $phaseScanContext -RootId "source_pnpm" -Root ([string]$Runtime.dependency_source_roots.pnpm_root) -HeldHandlesSink $runtimeSink
        if ($null -eq $nodeArchive) {
            $sourceNode = Get-FoundationCanonicalTreeIdentityFromLedger -Ledger $sourceNodeLedger -Mode source
        }
        else {
            $sourceNodeContentRoot = Join-FoundationValidatedChildPath -Parent ([string]$sourceNodeLedger.root) -Name ([string]$nodeArchive.content_root_relative_path)
            $sourceNode = Get-FoundationCanonicalTreeIdentityFromLedger -Ledger $sourceNodeLedger -Mode source -Root $sourceNodeContentRoot
            $sourceNode.root = [string]$sourceNodeLedger.root
        }
        $sourcePnpm = Get-FoundationCanonicalTreeIdentityFromLedger -Ledger $sourcePnpmLedger -Mode source
        Assert-FoundationCanonicalTreeExpectation $sourceNode (Get-FoundationObjectValue $sourceTrees "node") ("${Phase}_source_node")
        Assert-FoundationCanonicalTreeExpectation $sourcePnpm (Get-FoundationObjectValue $sourceTrees "pnpm") ("${Phase}_source_pnpm")
        $sourceDigest = Get-FoundationSha256Text (([string]$sourceNode.tree_sha256) + "|" + ([string]$sourcePnpm.tree_sha256))
        $snapshotDigest = $null
        $snapshotNode = $null
        $snapshotPnpm = $null
        $closure = $null
        $native = $null
        $policy = $null
        if ($IncludeSnapshot) {
            $snapshotNodeLedger = Add-FoundationPhaseRootLedger -Context $phaseScanContext -RootId "snapshot_node" -Root ([string]$SnapshotIdentity.node_root) -HeldHandlesSink $runtimeSink
            $snapshotPnpmLedger = Add-FoundationPhaseRootLedger -Context $phaseScanContext -RootId "snapshot_pnpm" -Root ([string]$SnapshotIdentity.pnpm_root) -HeldHandlesSink $runtimeSink
            if ($null -eq $nodeArchive) {
                $snapshotNode = Get-FoundationCanonicalTreeIdentityFromLedger -Ledger $snapshotNodeLedger -Mode snapshot
            }
            else {
                $snapshotNodeContentRoot = Join-FoundationValidatedChildPath -Parent ([string]$snapshotNodeLedger.root) -Name ([string]$nodeArchive.content_root_relative_path)
                $snapshotNode = Get-FoundationCanonicalTreeIdentityFromLedger -Ledger $snapshotNodeLedger -Mode snapshot -Root $snapshotNodeContentRoot
                $snapshotNode.root = [string]$snapshotNodeLedger.root
            }
            $snapshotPnpm = Get-FoundationCanonicalTreeIdentityFromLedger -Ledger $snapshotPnpmLedger -Mode snapshot
            Assert-FoundationCanonicalTreeExpectation $snapshotNode (Get-FoundationObjectValue $snapshotTrees "node") ("${Phase}_snapshot_node")
            Assert-FoundationCanonicalTreeExpectation $snapshotPnpm (Get-FoundationObjectValue $snapshotTrees "pnpm") ("${Phase}_snapshot_pnpm")
            $snapshotDigest = Get-FoundationSha256Text (([string]$snapshotNode.tree_sha256) + "|" + ([string]$snapshotPnpm.tree_sha256))
            $closure = Get-FoundationFreshModuleClosureIdentity -Runtime $Runtime -Phase $Phase -PhaseScanContext $phaseScanContext
            $native = Get-FoundationFreshNativeExecutionIdentity -Runtime $Runtime -SnapshotIdentity $SnapshotIdentity -Phase $Phase -PhaseScanContext $phaseScanContext
            if ($null -eq $PolicyModule -or $null -eq $PolicyModule.pin_handle) { throw "TRUSTED_POLICY_CONTRACT_INVALID" }
            $policyHash = [FoundationValidationNativePath]::Sha256($PolicyModule.pin_handle)
            $policyInfo = [FoundationValidationNativePath]::GetInfo($PolicyModule.pin_handle)
            if ($policyHash -cne $script:FoundationFrozenPolicySha256 -or [long]$policyInfo.Length -ne $script:FoundationFrozenPolicyLength) { throw "TRUSTED_POLICY_CONTRACT_INVALID" }
            $policy = [pscustomobject][ordered]@{ path = [string]$SnapshotIdentity.policy_module_path; length = [long]$policyInfo.Length; sha256 = $policyHash; line_count = $script:FoundationFrozenPolicyLineCount; ascii_only = $true }
        }
        $commandInputIdentities = New-Object System.Collections.ArrayList
        if ($null -ne $CommandSpec) {
            $commandSink = $RetainedHandles
            if (-not $RetainCommandInputs) {
                $transientCommandHandles = New-Object System.Collections.ArrayList
                $commandSink = $transientCommandHandles
            }
            $actualCommandInput = Add-FoundationCommandImmutableInputPins -Spec $CommandSpec -Runtime $Runtime -Sink $commandSink
            if ($null -ne $ExpectedCommandInputIdentity) {
                Assert-FoundationCommandInputIdentity -Actual $actualCommandInput -Expected $ExpectedCommandInputIdentity -CommandId ([string]$CommandSpec.id) -AllowBuildOutput $AllowBuildOutput
            }
            [void]$commandInputIdentities.Add([pscustomobject][ordered]@{ command_id = [string]$CommandSpec.id; identity = $actualCommandInput })
        }
        foreach ($finalSpec in @($CommandSpecs)) {
            $finalId = [string]$finalSpec.id
            $expectedFinalInput = Get-FoundationObjectValue $CommandInputExpectations $finalId
            if ($null -eq $expectedFinalInput) { throw "RUNTIME_IDENTITY_INVALID:${finalId}:command_input_expectation_missing" }
            if ($null -eq $transientCommandHandles) { $transientCommandHandles = New-Object System.Collections.ArrayList }
            $actualFinalInput = Add-FoundationCommandImmutableInputPins -Spec $finalSpec -Runtime $Runtime -Sink $transientCommandHandles
            Assert-FoundationCommandInputIdentity -Actual $actualFinalInput -Expected $expectedFinalInput -CommandId $finalId
            [void]$commandInputIdentities.Add([pscustomobject][ordered]@{ command_id = $finalId; identity = $actualFinalInput })
        }
        if ($RequireExecutionQuiescence) { Assert-FoundationRuntimeExecutionQuiescent -Commands $Commands -Specs $Specs }
        return [pscustomobject][ordered]@{
            phase = $Phase; command_id = $CommandId; matched = $true; error_code = $null
            source_tree_sha256 = $sourceDigest; snapshot_tree_sha256 = $snapshotDigest
            snapshot_check_applicable = [bool]$IncludeSnapshot
            source_trees = [pscustomobject][ordered]@{ node = $sourceNode; pnpm = $sourcePnpm }
            snapshot_trees = if ($IncludeSnapshot) { [pscustomobject][ordered]@{ node = $snapshotNode; pnpm = $snapshotPnpm } } else { $null }
            module_closure = $closure
            native_execution_allowlist = $native
            policy_bootstrap = $policy
            command_input_identities = @($commandInputIdentities)
            pinned_input_count = Get-FoundationLivePinnedInputCount -Handles $RetainedHandles -AdditionalHandles $transientCommandHandles -PolicyModule $PolicyModule
        }
    }
    finally {
        if ($null -ne $phaseScanContext) { Close-FoundationPhaseScanContext $phaseScanContext }
        if ($null -ne $transientCommandHandles) { Close-FoundationHandleCollection $transientCommandHandles }
        if ($null -ne $ownedHandles) { Close-FoundationHandleCollection $ownedHandles }
    }
}

function Assert-FoundationConfiguredToolSource {
    param($Runtime, [string]$Name, [string]$RuntimePathProperty)
    Initialize-FoundationNativePathType
    $toolExpectation = Get-FoundationObjectValue (Get-FoundationObjectValue $Runtime.identity_expectations "tools") $Name
    if ($null -eq $toolExpectation) { throw "RUNTIME_IDENTITY_INVALID:${Name}:expectation_missing" }
    $configuredTarget = ConvertTo-FoundationStrictLocalPath ([string](Get-FoundationObjectValue $toolExpectation "configured_target_path"))
    $configuredEntry = ConvertTo-FoundationStrictLocalPath ([string](Get-FoundationObjectValue $toolExpectation "configured_entry_path"))
    $physicalTarget = ConvertTo-FoundationStrictLocalPath ([string](Get-FoundationObjectValue $toolExpectation "physical_target_path"))
    $physicalEntry = ConvertTo-FoundationStrictLocalPath ([string](Get-FoundationObjectValue $toolExpectation "physical_entry_path"))
    $expectedConfiguredTarget = ConvertTo-FoundationStrictLocalPath (Join-Path ([string]$Runtime.dependency_source_roots.tool_modules_root) $Name)
    if (-not $configuredTarget.Equals($expectedConfiguredTarget, [System.StringComparison]::OrdinalIgnoreCase) -or
        -not $configuredEntry.Equals((ConvertTo-FoundationStrictLocalPath ([string]$Runtime.$RuntimePathProperty)), [System.StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-FoundationPathContained -Parent ([string]$Runtime.dependency_source_roots.pnpm_root) -Candidate $physicalTarget)) {
        throw "RUNTIME_IDENTITY_INVALID:${Name}:configured_layout"
    }
    $parentPins = New-FoundationPinnedPathChain -Path (Split-Path -Parent $configuredTarget) -ShareWrite $false -AllowMissing $false
    $junctionHandle = $null
    try {
        $junctionHandle = [FoundationValidationNativePath]::OpenImmutableRead($configuredTarget)
        $junctionInfo = [FoundationValidationNativePath]::GetInfo($junctionHandle)
        if (($junctionInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -eq 0 -or
            ($junctionInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -eq 0) {
            throw "RUNTIME_IDENTITY_INVALID:${Name}:configured_target_not_junction"
        }
        $actualTarget = ConvertTo-FoundationStrictLocalPath ([FoundationValidationNativePath]::GetJunctionTarget($junctionHandle))
        if (-not $actualTarget.Equals($physicalTarget, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "RUNTIME_IDENTITY_INVALID:${Name}:junction_target"
        }
    }
    finally {
        if ($null -ne $junctionHandle) { $junctionHandle.Dispose() }
        Close-FoundationPinSet $parentPins
    }
    $targetIdentity = Get-FoundationCanonicalTreeIdentity -Root $physicalTarget -Mode source
    Assert-FoundationCanonicalTreeExpectation $targetIdentity (Get-FoundationObjectValue $toolExpectation "tree") "tool_${Name}"
    if ([int]$targetIdentity.reparse_count -ne 0) { throw "RUNTIME_IDENTITY_INVALID:${Name}:target_reparse" }
    $entryPins = New-FoundationPinnedPathChain -Path $physicalEntry -ShareWrite $false -AllowMissing $false
    $entryHandle = $null
    try {
        $entryHandle = [FoundationValidationNativePath]::OpenImmutableRead($physicalEntry)
        $entryInfo = [FoundationValidationNativePath]::GetInfo($entryHandle)
        $expectedLength = Get-FoundationObjectValue $toolExpectation "entry_length"
        $expectedHash = [string](Get-FoundationObjectValue $toolExpectation "entry_sha256")
        if (($entryInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0 -or
            ($entryInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0 -or
            ($null -ne $expectedLength -and [long]$entryInfo.Length -ne [long]$expectedLength) -or
            [FoundationValidationNativePath]::Sha256($entryHandle) -cne $expectedHash.ToUpperInvariant()) {
            throw "RUNTIME_IDENTITY_INVALID:${Name}:entry"
        }
    }
    finally {
        if ($null -ne $entryHandle) { $entryHandle.Dispose() }
        Close-FoundationPinSet $entryPins
    }
    return [pscustomobject][ordered]@{ name = $Name; configured_target_path = $configuredTarget; physical_target_path = $physicalTarget; physical_entry_path = $physicalEntry; tree = $targetIdentity; verified = $true }
}

function New-FoundationTypeboxStagingCapture {
    param([Parameter(Mandatory = $true)][string]$Root)
    $rootFull = ConvertTo-FoundationStrictLocalPath $Root
    $handles = New-Object System.Collections.ArrayList
    $entries = New-Object System.Collections.ArrayList
    $state = [pscustomobject]@{
        entries = $entries
        handles = $handles
        rows = (New-Object 'System.Collections.Generic.List[string]')
        relative_paths = (New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase))
        file_count = 0
        directory_count = 0
        total_bytes = [long]0
    }
    try {
        $visitor = {
            param($Entry, $State)
            $relative = [string]$Entry.relative_path
            if ([string]::IsNullOrWhiteSpace($relative) -or $relative -match '[|\r\n]' -or
                -not $State.relative_paths.Add($relative)) {
                throw "RUNTIME_MODULE_CLOSURE_INVALID:path"
            }
            if ([bool]$Entry.is_reparse) { throw "RUNTIME_MODULE_CLOSURE_INVALID:reparse" }
            $info = [pscustomobject][ordered]@{
                Attributes = [uint32]$Entry.info.Attributes
                Length = [long]$Entry.info.Length
                LastWriteTimeUtc = [datetime]$Entry.info.LastWriteTimeUtc
                VolumeSerial = [string]$Entry.info.VolumeSerial
                FileId = [string]$Entry.info.FileId
            }
            if ([bool]$Entry.is_directory) {
                [void]$State.entries.Add([pscustomobject][ordered]@{
                    relative_path = $relative
                    entry_kind = "directory"
                    info = $info
                    sha256 = $null
                    handle = $null
                })
                $State.directory_count = [int]$State.directory_count + 1
                return
            }
            $hash = [FoundationValidationNativePath]::Sha256($Entry.handle)
            $duplicate = $null
            try {
                $duplicate = [FoundationValidationNativePath]::DuplicatePinnedHandle($Entry.handle)
                [void]$State.handles.Add($duplicate)
                $ownedHandle = $duplicate
                $duplicate = $null
                [void]$State.entries.Add([pscustomobject][ordered]@{
                    relative_path = $relative
                    entry_kind = "file"
                    info = $info
                    sha256 = $hash
                    handle = $ownedHandle
                })
            }
            finally {
                if ($null -ne $duplicate) { $duplicate.Dispose() }
            }
            [void]$State.rows.Add("$relative|$($Entry.info.Length)|$hash")
            $State.file_count = [int]$State.file_count + 1
            $State.total_bytes = [long]$State.total_bytes + [long]$Entry.info.Length
        }
        Invoke-FoundationHandleTreeWalk -Root $rootFull -Visitor $visitor -State $state
        $state.rows.Sort([System.StringComparer]::OrdinalIgnoreCase)
        $packageEntries = @($entries | Where-Object {
            [string]$_.entry_kind -ceq "file" -and ([string]$_.relative_path).Equals("package.json", [System.StringComparison]::OrdinalIgnoreCase)
        })
        $packageHash = if ($packageEntries.Count -eq 1) { [string]$packageEntries[0].sha256 } else { $null }
        return [pscustomobject][ordered]@{
            schema_version = "foundation-typebox-staging-capture/v1"
            root = $rootFull
            entries = @($entries)
            handles = $handles
            file_count = [int]$state.file_count
            directory_count = [int]$state.directory_count
            total_bytes = [long]$state.total_bytes
            tree_sha256 = Get-FoundationSha256Text (@($state.rows) -join "`n")
            package_sha256 = $packageHash
            closed = $false
        }
    }
    catch {
        Close-FoundationHandleCollection $handles
        throw
    }
}

function Close-FoundationTypeboxStagingCapture {
    param($Capture)
    if ($null -eq $Capture -or [bool]$Capture.closed) { return }
    Close-FoundationHandleCollection $Capture.handles
    $Capture.closed = $true
}

function Copy-FoundationTypeboxStagingCapture {
    param(
        [Parameter(Mandatory = $true)]$Capture,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    if ([bool]$Capture.closed) { throw "PATH_IDENTITY_CHANGED:typebox_capture_closed" }
    $destinationFull = ConvertTo-FoundationStrictLocalPath $Destination
    $copyRows = New-Object System.Collections.ArrayList
    $relativePaths = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in @($Capture.entries)) {
        $relative = [string]$entry.relative_path
        if ([string]::IsNullOrWhiteSpace($relative) -or -not $relativePaths.Add($relative)) {
            throw "PATH_IDENTITY_CHANGED:typebox_capture_path"
        }
        $destinationPath = Join-FoundationValidatedRelativePath -Root $destinationFull -RelativePath $relative
        if ([string]$entry.entry_kind -ceq "directory") {
            [void]$copyRows.Add([pscustomobject]@{ entry = $entry; destination = $destinationPath; source_path = $null })
            continue
        }
        if ([string]$entry.entry_kind -cne "file" -or $null -eq $entry.handle -or [bool]$entry.handle.IsClosed -or
            [string]$entry.sha256 -cnotmatch '^[A-F0-9]{64}$') {
            throw "PATH_IDENTITY_CHANGED:typebox_capture_entry"
        }
        $sourcePath = Join-FoundationValidatedRelativePath -Root ([string]$Capture.root) -RelativePath $relative
        $currentInfo = [FoundationValidationNativePath]::GetInfo($entry.handle)
        $currentFinal = ConvertFrom-FoundationFinalHandlePath ([string]$currentInfo.FinalPath)
        $currentHash = [FoundationValidationNativePath]::Sha256($entry.handle)
        if (-not $currentFinal.Equals($sourcePath, [System.StringComparison]::OrdinalIgnoreCase) -or
            [uint32]$currentInfo.Attributes -ne [uint32]$entry.info.Attributes -or
            [long]$currentInfo.Length -ne [long]$entry.info.Length -or
            [string]$currentInfo.VolumeSerial -cne [string]$entry.info.VolumeSerial -or
            [string]$currentInfo.FileId -cne [string]$entry.info.FileId -or
            $currentHash -cne [string]$entry.sha256) {
            throw "PATH_IDENTITY_CHANGED:typebox_capture_entry"
        }
        [void]$copyRows.Add([pscustomobject]@{ entry = $entry; destination = $destinationPath; source_path = $sourcePath })
    }
    $destinationPins = $null
    try {
        $destinationPins = New-FoundationPinnedDirectory -Path $destinationFull -OperationId "staging_typebox_root"
        foreach ($row in @($copyRows)) {
            $entry = $row.entry
            if ([string]$entry.entry_kind -ceq "directory") {
                $directoryPins = New-FoundationPinnedDirectory -Path ([string]$row.destination) -OperationId "staging_typebox_directory"
                Close-FoundationPinSet $directoryPins
                continue
            }
            Copy-FoundationPinnedHandleFile -SourceHandle $entry.handle -SourceInfo $entry.info -Destination ([string]$row.destination) -ExpectedSha256 ([string]$entry.sha256) -ExpectedVolumeSerial ([string]$entry.info.VolumeSerial) -ExpectedFileId ([string]$entry.info.FileId) -ExpectedSourcePath ([string]$row.source_path)
        }
    }
    finally {
        Close-FoundationPinSet $destinationPins
    }
}

function New-FoundationPluginStaging {
    param(
        [string]$Route,
        [string]$RouteRoot,
        [string]$StagingRoot,
        $Runtime,
        [AllowNull()][scriptblock]$PathPhaseObserver = $null,
        [AllowNull()]$PathSecurityState = $null
    )
    $target = ConvertTo-FoundationStrictLocalPath ([string]$Runtime.dependency_source_roots.typebox_root)
    $typeboxExpected = Get-FoundationObjectValue (Get-FoundationObjectValue $Runtime.identity_expectations "module_closure") "staging_typebox"
    $typeboxCapture = $null
    $sourcePins = $null
    $operationPins = @()
    $operationId = "staging_copy:" + $Route
    $operationSucceeded = $false
    $operationError = $null
    try {
        try {
            $typeboxCapture = New-FoundationTypeboxStagingCapture -Root $target
            if ([int]$typeboxCapture.file_count -ne [int](Get-FoundationObjectValue $typeboxExpected "file_count") -or
                [long]$typeboxCapture.total_bytes -ne [long](Get-FoundationObjectValue $typeboxExpected "total_bytes") -or
                [string]$typeboxCapture.tree_sha256 -cne ([string](Get-FoundationObjectValue $typeboxExpected "tree_sha256")).ToUpperInvariant()) {
                throw "STAGING_DEPENDENCY_INVALID: frozen typebox identity"
            }
            $packageHash = [string]$typeboxCapture.package_sha256
            if ([string]::IsNullOrWhiteSpace($packageHash) -or
                $packageHash -cne ([string](Get-FoundationObjectValue $typeboxExpected "package_sha256")).ToUpperInvariant()) {
                throw "STAGING_DEPENDENCY_INVALID: frozen typebox package identity"
            }
            $sourcePins = New-FoundationPinnedPathChain -Path $target -ShareWrite $false -AllowMissing $false
            $packageRows = @($typeboxCapture.entries | Where-Object {
                [string]$_.entry_kind -ceq "file" -and ([string]$_.relative_path).Equals("package.json", [System.StringComparison]::OrdinalIgnoreCase)
            })
            if ($packageRows.Count -ne 1 -or $null -eq $packageRows[0].handle) { throw "STAGING_DEPENDENCY_INVALID: package pin" }
            $packageInfo = [FoundationValidationNativePath]::GetInfo($packageRows[0].handle)
            $packagePath = Join-FoundationValidatedChildPath -Parent $target -Name "package.json"
            $capturedPins = New-Object System.Collections.ArrayList
            foreach ($capturedEntry in @($typeboxCapture.entries | Where-Object { [string]$_.entry_kind -ceq "file" })) {
                if ($null -eq $capturedEntry.handle) { throw "STAGING_DEPENDENCY_INVALID: captured file pin" }
                $capturedPath = Join-FoundationValidatedRelativePath -Root $target -RelativePath ([string]$capturedEntry.relative_path)
                [void]$capturedPins.Add([pscustomobject][ordered]@{
                    path = $capturedPath; volume_serial = [string]$capturedEntry.info.VolumeSerial; file_id = [string]$capturedEntry.info.FileId
                    attributes = [uint32]$capturedEntry.info.Attributes; share_write = $false; share_delete = $false; handle = $capturedEntry.handle
                })
            }
            $operationPins = @($sourcePins.pins) + @($capturedPins)
            Invoke-FoundationPathPhaseObserver -Observer $PathPhaseObserver -Phase "staging_after_source_pin_before_copy" -OperationId $operationId -PinnedPaths $operationPins -TargetPath $packagePath
        }
        catch {
            $stagingDependencyError = [string]$_.Exception.Message
            if ($stagingDependencyError -like "PATH_IDENTITY_CHANGED*" -or
                $stagingDependencyError -like "STAGING_DEPENDENCY_INVALID*") {
                throw
            }
            throw "STAGING_DEPENDENCY_INVALID:$stagingDependencyError"
        }
        foreach ($name in @("package.json", "openclaw.plugin.json", "tsconfig.json")) {
            $sourceFile = Join-Path $RouteRoot $name
            Copy-FoundationPinnedFile -Source $sourceFile -Destination (Join-Path $StagingRoot $name)
        }
        foreach ($name in @("src", "tests", "skills")) {
            $sourceTree = Join-Path $RouteRoot $name
            Copy-FoundationOrdinaryTree -Source $sourceTree -Destination (Join-Path $StagingRoot $name) -RejectEnvironmentFiles
        }
        $nodeModules = Join-Path $StagingRoot "node_modules"
        $nodeModulePins = New-FoundationPinnedDirectory -Path $nodeModules -OperationId "staging_node_modules"
        Close-FoundationPinSet $nodeModulePins
        Copy-FoundationTypeboxStagingCapture -Capture $typeboxCapture -Destination (Join-Path $nodeModules "typebox")
        $operationSucceeded = $true
        $reportedOperationPins = @(Copy-FoundationPathPinRows $operationPins)
        [void](Add-FoundationPathSecurityOperation -State $PathSecurityState -OperationId $operationId -OperationKind "staging_copy" -Phase "complete" -PinnedPaths $reportedOperationPins -ImmutableInputCount (@($reportedOperationPins | Where-Object { -not [bool]$_.share_write }).Count) -Succeeded $true)
        return [pscustomobject]@{
            route = $Route; staging_root = $StagingRoot
            path_operation_ids = @($operationId)
            dependency = [pscustomobject]@{ name = "typebox"; version = "1.3.11"; file_count = [int]$typeboxCapture.file_count; total_bytes = [long]$typeboxCapture.total_bytes; tree_sha256 = [string]$typeboxCapture.tree_sha256; package_sha256 = $packageHash; staged_as_reparse = $false }
        }
    }
    catch {
        $operationError = Get-FoundationPathOperationErrorCode $_.Exception.ToString()
        if ($null -ne $PathSecurityState -and -not $PathSecurityState.operation_ids.Contains($operationId)) {
            $reportedFailurePins = @(Copy-FoundationPathPinRows $operationPins)
            [void](Add-FoundationPathSecurityOperation -State $PathSecurityState -OperationId $operationId -OperationKind "staging_copy" -Phase "complete" -PinnedPaths $reportedFailurePins -ImmutableInputCount (@($reportedFailurePins | Where-Object { -not [bool]$_.share_write }).Count) -Succeeded $false -ErrorCode $operationError)
        }
        throw
    }
    finally {
        Close-FoundationPinSet $sourcePins
        Close-FoundationTypeboxStagingCapture $typeboxCapture
    }
}

function New-FoundationCommandObject {
    param($Spec)
    return [pscustomobject][ordered]@{
        id = [string]$Spec.id; route = [string]$Spec.route; stage = [string]$Spec.stage; cwd = [string]$Spec.cwd
        executable = [string]$Spec.executable; arguments = @($Spec.arguments)
        staging_root = $Spec.staging_root; runtime_snapshot_root = $Spec.runtime_snapshot_root
        module_resolution_roots = @($Spec.module_resolution_roots); permission_model = $Spec.permission_model
        node_runtime = $Spec.node_runtime; execution_topology = $Spec.execution_topology
        environment_policy = $Spec.environment_policy
        path_operation_ids = if ($null -ne $Spec.PSObject.Properties["path_operation_ids"]) { @($Spec.path_operation_ids) } else { @() }
        started_at = $null; finished_at = $null; status = "skipped"; exit_code = $null; stdout = ""; stderr = ""
        environment_key_names = @(); environment_value_sources = @(); exception_type = $null; exception_text = $null
        timeout_ms = 120000; timed_out = $false; reason = "prior_failure"; process_id = $null; error_code = $null
        process_identity = $null; job_control = $null
        policy_attestations = @(); spawn_intents = @(); spawn_results = @(); addon_loads = @()
        stream_capture = [pscustomobject]@{ stdout_completed = $false; stderr_completed = $false; deadline_exceeded = $false }
        fault_injection = [pscustomobject][ordered]@{ active = $false; phase = $null; injected = $false; error_type = $null; error_text = $null }
        taskkill = New-FoundationEmptyTaskkillResult
        termination_errors = @()
        stdout_raw_path = $null; stdout_sha256 = $null; stderr_raw_path = $null; stderr_sha256 = $null; exception_raw_path = $null; exception_sha256 = $null
    }
}

function New-FoundationCommandLaunchPinBundle {
    param([Parameter(Mandatory = $true)]$Spec)
    $pinSets = New-Object System.Collections.ArrayList
    $pins = New-Object System.Collections.ArrayList
    $desired = New-Object 'System.Collections.Generic.Dictionary[string,bool]' ([System.StringComparer]::OrdinalIgnoreCase)
    $immutable = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    try {
        $paths = New-Object System.Collections.ArrayList
        [void]$paths.Add([pscustomobject]@{ path = [string]$Spec.executable; share_write = $false })
        [void]$immutable.Add((ConvertTo-FoundationStrictLocalPath ([string]$Spec.executable)))
        if ([string]$Spec.id -ceq "A.structure" -and @($Spec.arguments).Count -gt 0) {
            [void]$paths.Add([pscustomobject]@{ path = [string]@($Spec.arguments)[-1]; share_write = $false })
            [void]$immutable.Add((ConvertTo-FoundationStrictLocalPath ([string]@($Spec.arguments)[-1])))
        }
        foreach ($path in @($Spec.staging_root, $Spec.runtime_snapshot_root) + @($Spec.module_resolution_roots) + @($Spec.permission_model.fs_read_roots)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$path)) { [void]$paths.Add([pscustomobject]@{ path = [string]$path; share_write = $false }) }
        }
        foreach ($path in @($Spec.permission_model.fs_write_roots)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$path)) { [void]$paths.Add([pscustomobject]@{ path = [string]$path; share_write = $true }) }
        }
        foreach ($row in @($paths)) {
            $full = ConvertTo-FoundationStrictLocalPath ([string]$row.path)
            $shareWrite = [bool]$row.share_write
            if (-not $desired.ContainsKey($full)) {
                $desired.Add($full, $shareWrite)
            }
            elseif ($shareWrite -and -not $immutable.Contains($full)) {
                $desired[$full] = $true
            }
        }
        $orderedPaths = @($desired.Keys)
        [array]::Sort($orderedPaths, [System.StringComparer]::OrdinalIgnoreCase)
        foreach ($full in $orderedPaths) {
            $shareWrite = [bool]$desired[$full]
            $pinSet = New-FoundationPinnedPathChain -Path $full -ShareWrite $shareWrite -AllowMissing $false
            [void]$pinSets.Add($pinSet)
            foreach ($pin in @($pinSet.pins)) { [void]$pins.Add($pin) }
        }
        $reportedPins = @(Copy-FoundationPathPinRows @($pins))
        return [pscustomobject]@{ pin_sets = $pinSets; pins = @($pins); immutable_input_count = @($reportedPins | Where-Object { -not [bool]$_.share_write }).Count; closed = $false }
    }
    catch {
        foreach ($pinSet in @($pinSets)) { Close-FoundationPinSet $pinSet }
        throw
    }
}

function Close-FoundationCommandLaunchPinBundle {
    param($Bundle)
    if ($null -eq $Bundle -or [bool]$Bundle.closed) { return }
    foreach ($pinSet in @($Bundle.pin_sets)) { Close-FoundationPinSet $pinSet }
    $Bundle.closed = $true
}

function ConvertTo-FoundationEvidenceJson {
    param($Value)
    return [string]($Value | ConvertTo-Json -Depth 32 -Compress)
}

function Assert-FoundationRunnerEvidenceMatchesPhysical {
    param($RunnerRows, $PhysicalRows, [string]$Code)
    $runner = @($RunnerRows)
    $physical = @($PhysicalRows)
    if ($runner.Count -ne $physical.Count) { throw $Code }
    for ($index = 0; $index -lt $physical.Count; $index++) {
        if ((ConvertTo-FoundationEvidenceJson $runner[$index]) -cne (ConvertTo-FoundationEvidenceJson $physical[$index])) {
            throw $Code
        }
    }
}

function Read-FoundationPhysicalPolicyJournal {
    param($Spec, $RunnerResult)
    Initialize-FoundationNativePathType
    $root = ConvertTo-FoundationStrictLocalPath ([string]$Spec.execution_topology.policy_attestation_root)
    $rootPins = New-FoundationPinnedPathChain -Path $root -ShareWrite $false -AllowMissing $false
    $policyRows = New-Object System.Collections.ArrayList
    $spawnIntents = New-Object System.Collections.ArrayList
    $spawnResults = New-Object System.Collections.ArrayList
    $addonIntents = New-Object System.Collections.ArrayList
    $addonResults = New-Object System.Collections.ArrayList
    $auditEntries = New-Object System.Collections.ArrayList
    $seenNames = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $seenTypedIds = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    $rootHandle = $null
    $initialBatch = $null
    try {
        $rootHandle = [FoundationValidationNativePath]::OpenImmutableRead($root)
        $rootInfo = [FoundationValidationNativePath]::GetInfo($rootHandle)
        $rootFinal = ConvertFrom-FoundationFinalHandlePath ([string]$rootInfo.FinalPath)
        if (-not $rootFinal.Equals($root, [System.StringComparison]::OrdinalIgnoreCase) -or
            ($rootInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -eq 0 -or
            ($rootInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0) {
            throw "PATH_REPARSE_POINT_REJECTED:$root"
        }
        $initialBatch = Get-FoundationPinnedDirectoryChildren -TrustedRoot $root -DirectoryPath $root -DirectoryHandle $rootHandle -OpenMode immutable
        $initialItems = @($initialBatch.entries)
        foreach ($item in $initialItems) {
            if ([bool]$item.is_directory -or [bool]$item.is_reparse) {
                throw "PATH_REPARSE_POINT_REJECTED:$($item.path)"
            }
            if (-not $seenNames.Add([string]$item.name)) { throw "TRUSTED_POLICY_ATTESTATION_INVALID" }
            $path = ConvertTo-FoundationStrictLocalPath ([string]$item.path)
            $handle = $item.handle
            $info = $item.info
                if (($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0 -or
                    ($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0 -or
                    $info.Length -gt 8388608) {
                    throw "TRUSTED_POLICY_ATTESTATION_INVALID"
                }
                $bytes = [FoundationValidationNativePath]::ReadAll($handle)
                $strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
                $text = $strictUtf8.GetString($bytes)
                $row = $text | ConvertFrom-Json -ErrorAction Stop
                $name = [string]$item.name
                $schema = [string](Get-FoundationObjectValue $row "schema_version")
                $id = [string](Get-FoundationObjectValue $row "id")
                if ($name -match '^policy-ready-([1-9][0-9]*)\.json$' -and $schema -ceq "foundation-policy-attestation/v2") {
                    if ([string](Get-FoundationObjectValue $row "pid") -cne [string]$Matches[1] -or -not $seenTypedIds.Add("policy:$($Matches[1])")) {
                        throw "TRUSTED_POLICY_ATTESTATION_INVALID"
                    }
                    [void]$policyRows.Add($row)
                }
                elseif ($name -match '^spawn-([1-9][0-9]*-[0-9]{4})-intent\.json$' -and $schema -ceq "foundation-spawn-intent/v1") {
                    if ($id -cne [string]$Matches[1] -or -not $seenTypedIds.Add("spawn-intent:$id")) { throw "TRUSTED_POLICY_SPAWN_JOURNAL_INVALID" }
                    [void]$spawnIntents.Add($row)
                }
                elseif ($name -match '^spawn-([1-9][0-9]*-[0-9]{4})-result\.json$' -and $schema -ceq "foundation-spawn-result/v1") {
                    if ($id -cne [string]$Matches[1] -or -not $seenTypedIds.Add("spawn-result:$id")) { throw "TRUSTED_POLICY_SPAWN_JOURNAL_INVALID" }
                    [void]$spawnResults.Add($row)
                }
                elseif ($name -match '^addon-([1-9][0-9]*-[0-9]{4})-intent\.json$' -and $schema -ceq "foundation-addon-intent/v1") {
                    if ($id -cne [string]$Matches[1] -or -not $seenTypedIds.Add("addon-intent:$id")) { throw "TRUSTED_POLICY_ADDON_JOURNAL_INVALID" }
                    [void]$addonIntents.Add($row)
                }
                elseif ($name -match '^addon-([1-9][0-9]*-[0-9]{4})-result\.json$' -and $schema -ceq "foundation-addon-result/v1") {
                    if ($id -cne [string]$Matches[1] -or -not $seenTypedIds.Add("addon-result:$id")) { throw "TRUSTED_POLICY_ADDON_JOURNAL_INVALID" }
                    [void]$addonResults.Add($row)
                }
                else {
                    throw "TRUSTED_POLICY_ATTESTATION_INVALID"
                }
                [void]$auditEntries.Add([pscustomobject][ordered]@{
                    full_path = $path
                    relative_path = $name
                    length = [long]$info.Length
                    sha256 = Get-FoundationSha256Bytes $bytes
                    last_write_time_utc = $info.LastWriteTimeUtc.ToString("o")
                    classification = "other"
                    candidate_kind = $null
                    creation_stage = [string]$Spec.id
                })
        }
        $finalBatch = Get-FoundationPinnedDirectoryChildren -TrustedRoot $root -DirectoryPath $root -DirectoryHandle $rootHandle -OpenMode immutable
        try {
            $finalItems = @($finalBatch.entries)
            if ($initialItems.Count -ne $finalItems.Count) { throw "TRUSTED_POLICY_ATTESTATION_INVALID" }
            for ($itemIndex = 0; $itemIndex -lt $initialItems.Count; $itemIndex++) {
                $beforeItem = $initialItems[$itemIndex]
                $afterItem = $finalItems[$itemIndex]
                if ([string]$beforeItem.name -cne [string]$afterItem.name -or
                    [string]$beforeItem.info.VolumeSerial -cne [string]$afterItem.info.VolumeSerial -or
                    [string]$beforeItem.info.FileId -cne [string]$afterItem.info.FileId -or
                    [uint32]$beforeItem.info.Attributes -ne [uint32]$afterItem.info.Attributes -or
                    [long]$beforeItem.info.Length -ne [long]$afterItem.info.Length) {
                    throw "TRUSTED_POLICY_ATTESTATION_INVALID"
                }
            }
        }
        finally {
            foreach ($finalItem in @($finalBatch.entries)) { if ($null -ne $finalItem.handle) { $finalItem.handle.Dispose() } }
        }
        if ($policyRows.Count -lt 1) { throw "TRUSTED_POLICY_ATTESTATION_INVALID" }
        if ($spawnIntents.Count -ne $spawnResults.Count) { throw "TRUSTED_POLICY_SPAWN_JOURNAL_INVALID" }
        foreach ($intent in @($spawnIntents)) {
            if (@($spawnResults | Where-Object { [string]$_.id -ceq [string]$intent.id }).Count -ne 1) { throw "TRUSTED_POLICY_SPAWN_JOURNAL_INVALID" }
        }
        if ($addonIntents.Count -ne $addonResults.Count) { throw "TRUSTED_POLICY_ADDON_JOURNAL_INVALID" }
        $addonLoads = New-Object System.Collections.ArrayList
        foreach ($intent in @($addonIntents)) {
            $matches = @($addonResults | Where-Object { [string]$_.id -ceq [string]$intent.id })
            if ($matches.Count -ne 1) { throw "TRUSTED_POLICY_ADDON_JOURNAL_INVALID" }
            $result = $matches[0]
            if ([string]$result.pid -cne [string]$intent.pid -or [string]$result.path -cne [string]$intent.path -or [string]$result.sha256 -cne [string]$intent.sha256) {
                throw "TRUSTED_POLICY_ADDON_JOURNAL_INVALID"
            }
            [void]$addonLoads.Add([pscustomobject][ordered]@{
                pid = [int]$intent.pid; path = [string]$intent.path; path_kind = [string]$intent.path_kind
                length = [long]$intent.length; sha256 = [string]$intent.sha256; success = [bool]$result.success
            })
        }
        $journalSequence = @(@($spawnIntents) + @($addonIntents) | ForEach-Object {
            if ([string]$_.id -notmatch '^[1-9][0-9]*-([0-9]{4})$') { throw "TRUSTED_POLICY_SPAWN_JOURNAL_INVALID" }
            [int]$Matches[1]
        } | Sort-Object)
        for ($sequenceIndex = 0; $sequenceIndex -lt $journalSequence.Count; $sequenceIndex++) {
            if ([int]$journalSequence[$sequenceIndex] -ne ($sequenceIndex + 1)) { throw "TRUSTED_POLICY_SPAWN_JOURNAL_INVALID" }
        }
        if ($null -ne $RunnerResult) {
            Assert-FoundationRunnerEvidenceMatchesPhysical $RunnerResult.policy_attestations @($policyRows) "TRUSTED_POLICY_ATTESTATION_INVALID"
            Assert-FoundationRunnerEvidenceMatchesPhysical $RunnerResult.spawn_intents @($spawnIntents) "TRUSTED_POLICY_SPAWN_JOURNAL_INVALID"
            Assert-FoundationRunnerEvidenceMatchesPhysical $RunnerResult.spawn_results @($spawnResults) "TRUSTED_POLICY_SPAWN_JOURNAL_INVALID"
            Assert-FoundationRunnerEvidenceMatchesPhysical $RunnerResult.addon_loads @($addonLoads) "TRUSTED_POLICY_ADDON_JOURNAL_INVALID"
            if ($null -eq $RunnerResult.job_control -or $null -eq $RunnerResult.job_control.spawn_journal) { throw "TRUSTED_POLICY_SPAWN_JOURNAL_INVALID" }
            Assert-FoundationRunnerEvidenceMatchesPhysical $RunnerResult.job_control.spawn_journal.intents @($spawnIntents) "TRUSTED_POLICY_SPAWN_JOURNAL_INVALID"
            Assert-FoundationRunnerEvidenceMatchesPhysical $RunnerResult.job_control.spawn_journal.results @($spawnResults) "TRUSTED_POLICY_SPAWN_JOURNAL_INVALID"
            if (-not [bool]$RunnerResult.job_control.spawn_journal.matched) { throw "TRUSTED_POLICY_SPAWN_JOURNAL_INVALID" }
        }
        return [pscustomobject][ordered]@{
            policy_attestations = @($policyRows)
            spawn_intents = @($spawnIntents)
            spawn_results = @($spawnResults)
            addon_loads = @($addonLoads)
            audit_entries = @($auditEntries)
        }
    }
    catch {
        if ($_.Exception.Message -match 'PATH_REPARSE_POINT_REJECTED') { throw }
        if ($_.Exception.Message -match 'TRUSTED_POLICY_[A-Z_]+_INVALID') { throw }
        throw "TRUSTED_POLICY_ATTESTATION_INVALID:$($_.Exception.Message)"
    }
    finally {
        foreach ($initialItem in @($initialBatch.entries)) { if ($null -ne $initialItem.handle) { $initialItem.handle.Dispose() } }
        if ($null -ne $rootHandle) { $rootHandle.Dispose() }
        Close-FoundationPinSet $rootPins
    }
}

function Get-FoundationFreshPolicyJournalAuditEntries {
    param($Specifications, $Commands)
    $specMap = @{}
    foreach ($spec in @($Specifications)) { $specMap[[string]$spec.id] = $spec }
    $rows = New-Object System.Collections.ArrayList
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($command in @($Commands | Where-Object { [string]$_.status -ceq "passed" })) {
        $commandId = [string]$command.id
        if (-not $specMap.ContainsKey($commandId)) { throw "TRUSTED_POLICY_ATTESTATION_INVALID:$commandId:spec" }
        $spec = $specMap[$commandId]
        if ($null -eq $spec.node_runtime) { continue }
        $evidence = Read-FoundationPhysicalPolicyJournal -Spec $spec -RunnerResult $command
        foreach ($entry in @($evidence.audit_entries)) {
            $fullPath = ConvertTo-FoundationStrictLocalPath ([string]$entry.full_path)
            if (-not $seen.Add($fullPath)) { throw "TRUSTED_POLICY_ATTESTATION_INVALID:$fullPath:duplicate_audit_path" }
            [void]$rows.Add($entry)
        }
    }
    return @($rows)
}

function Set-FoundationPhysicalPolicyEvidence {
    param($Result, $Evidence)
    foreach ($name in @("policy_attestations", "spawn_intents", "spawn_results", "addon_loads")) {
        if ($null -eq $Result.PSObject.Properties[$name]) { $Result | Add-Member -NotePropertyName $name -NotePropertyValue @($Evidence.$name) }
        else { $Result.$name = @($Evidence.$name) }
    }
    if ($null -ne $Result.PSObject.Properties["job_control"] -and $null -ne $Result.job_control -and $null -ne $Result.job_control.PSObject.Properties["spawn_journal"]) {
        $Result.job_control.spawn_journal.intents = @($Evidence.spawn_intents)
        $Result.job_control.spawn_journal.results = @($Evidence.spawn_results)
        $Result.job_control.spawn_journal.matched = $true
    }
    return $Result
}

function Complete-FoundationNativePolicyJobEvidence {
    param($Spec, $Result, $Evidence)
    if ($null -eq $Result.process_identity -or $null -eq $Result.job_control -or
        $null -eq $Result.job_control.completion_telemetry -or $null -eq $Result.job_control.accounting) {
        throw "PROCESS_JOB_ACCOUNTING_MISMATCH:$($Spec.id):native_result"
    }
    $parentPid = [int]$Result.process_identity.pid
    if ($parentPid -le 0 -or [int]$Result.process_id -ne $parentPid) { throw "PROCESS_PID_IDENTITY_MISMATCH:$($Spec.id)" }

    $intentById = @{}
    foreach ($intent in @($Evidence.spawn_intents)) {
        $intentId = [string]$intent.id
        if ([string]::IsNullOrWhiteSpace($intentId) -or $intentById.ContainsKey($intentId) -or [int]$intent.parent_pid -ne $parentPid -or
            @("vitest_single_fork", "snapshot_node_helper", "esbuild") -cnotcontains [string]$intent.role) {
            throw "TRUSTED_POLICY_SPAWN_JOURNAL_INVALID"
        }
        $intentById[$intentId] = $intent
    }
    $expectedPidToIntent = @{}
    foreach ($spawnResult in @($Evidence.spawn_results)) {
        $resultId = [string]$spawnResult.id
        if (-not $intentById.ContainsKey($resultId) -or [int]$spawnResult.parent_pid -ne $parentPid -or -not ($spawnResult.success -is [bool])) {
            throw "TRUSTED_POLICY_SPAWN_JOURNAL_INVALID"
        }
        if ([bool]$spawnResult.success) {
            $spawnPid = [int]$spawnResult.pid
            if ($spawnPid -le 0 -or $spawnPid -eq $parentPid -or $expectedPidToIntent.ContainsKey($spawnPid)) { throw "TRUSTED_POLICY_SPAWN_JOURNAL_INVALID" }
            $expectedPidToIntent[$spawnPid] = $intentById[$resultId]
        }
        elseif ($null -ne $spawnResult.PSObject.Properties["pid"] -and $null -ne $spawnResult.pid) {
            throw "TRUSTED_POLICY_SPAWN_JOURNAL_INVALID"
        }
    }
    if ($intentById.Count -ne @($Evidence.spawn_results).Count) { throw "TRUSTED_POLICY_SPAWN_JOURNAL_INVALID" }

    $directAttestations = @($Evidence.policy_attestations | Where-Object { [int]$_.pid -eq $parentPid -and [string]$_.role -ceq "direct_parent" })
    if ($directAttestations.Count -ne 1) { throw "TRUSTED_POLICY_ATTESTATION_INVALID" }
    foreach ($spawnPid in @($expectedPidToIntent.Keys)) {
        $intent = $expectedPidToIntent[$spawnPid]
        if ([string]$intent.role -cne "esbuild") {
            $childAttestations = @($Evidence.policy_attestations | Where-Object { [int]$_.pid -eq [int]$spawnPid -and [int]$_.ppid -eq $parentPid -and [string]$_.role -ceq [string]$intent.role })
            if ($childAttestations.Count -ne 1) { throw "TRUSTED_POLICY_ATTESTATION_INVALID" }
        }
    }

    $expectedPids = New-Object 'System.Collections.Generic.List[int]'
    $expectedPids.Add($parentPid)
    foreach ($spawnPid in @($expectedPidToIntent.Keys)) { $expectedPids.Add([int]$spawnPid) }
    $expectedPids.Sort()
    $actualPids = New-Object 'System.Collections.Generic.List[int]'
    foreach ($actualPid in @($Result.job_control.completion_telemetry.unique_new_pids)) {
        if (-not $actualPids.Contains([int]$actualPid)) { $actualPids.Add([int]$actualPid) }
    }
    $actualPids.Sort()
    if ((@($expectedPids) -join "|") -cne (@($actualPids) -join "|")) { throw "PROCESS_JOB_ACCOUNTING_MISMATCH:$($Spec.id):pid_set" }
    if (@($Result.job_control.completion_telemetry.identity_failures).Count -ne 0) { throw "PROCESS_DESCENDANT_IDENTITY_UNAVAILABLE:$($Spec.id)" }

    $messages = @($Result.job_control.completion_telemetry.messages)
    foreach ($expectedPid in @($expectedPids)) {
        $matches = @($messages | Where-Object { [int]$_.pid -eq [int]$expectedPid })
        if ($matches.Count -ne 1) { throw "PROCESS_COMPLETION_TELEMETRY_INCOMPLETE:$($Spec.id):$expectedPid" }
        $message = $matches[0]
        if ([long]$message.start_time_filetime_utc -le 0 -or [string]::IsNullOrWhiteSpace([string]$message.executable_path) -or
            [long]$message.length -le 0 -or [string]$message.sha256 -notmatch '^[A-F0-9]{64}$' -or -not [bool]$message.exit_observed) {
            throw "PROCESS_DESCENDANT_IDENTITY_UNAVAILABLE:$($Spec.id):$expectedPid"
        }
        if ([int]$expectedPid -eq $parentPid) {
            if (-not (Test-FoundationPathEqual ([string]$message.executable_path) ([string]$Result.process_identity.executable_path)) -or
                [long]$message.length -ne [long]$Result.process_identity.length -or [string]$message.sha256 -cne [string]$Result.process_identity.sha256) {
                throw "PROCESS_PID_IDENTITY_MISMATCH:$($Spec.id)"
            }
            $message.role = "direct_parent"
            $message.spawn_journal_id = $null
            $message.snapshot_manifest_match = $true
        }
        else {
            $intent = $expectedPidToIntent[[int]$expectedPid]
            if (-not (Test-FoundationPathEqual ([string]$message.executable_path) ([string]$intent.executable_path)) -or
                [string]$message.sha256 -cne ([string]$intent.executable_sha256).ToUpperInvariant()) {
                throw "PROCESS_DESCENDANT_IDENTITY_UNAVAILABLE:$($Spec.id):$expectedPid"
            }
            $message.role = [string]$intent.role
            $message.spawn_journal_id = [string]$intent.id
            $message.snapshot_manifest_match = $true
        }
    }

    $expectedTotal = $expectedPids.Count
    $actualTotal = [int]$Result.job_control.accounting.total_processes
    $activeProcesses = [int]$Result.job_control.accounting.active_processes
    $matched = $actualTotal -eq $expectedTotal -and $activeProcesses -eq 0 -and [bool]$Result.job_control.completion_telemetry.active_zero_observed
    $Result.job_control.accounting.expected_total_processes = $expectedTotal
    $Result.job_control.accounting.matched = $matched
    if (-not $matched) { throw "PROCESS_JOB_ACCOUNTING_MISMATCH:$($Spec.id):accounting" }

    $Result = Set-FoundationPhysicalPolicyEvidence -Result $Result -Evidence $Evidence
    if ($null -ne $Result.PSObject.Properties["foundation_native_evidence_pending"]) { $Result.PSObject.Properties.Remove("foundation_native_evidence_pending") }
    return $Result
}

function Merge-FoundationCommandResult {
    param($Spec, $Result)
    $command = New-FoundationCommandObject $Spec
    foreach ($name in @("started_at", "finished_at", "status", "exit_code", "stdout", "stderr", "environment_key_names", "environment_value_sources", "exception_type", "exception_text", "timeout_ms", "timed_out", "process_id", "error_code", "process_identity", "job_control", "policy_attestations", "spawn_intents", "spawn_results", "addon_loads", "stream_capture", "fault_injection", "taskkill", "termination_errors")) {
        if ($null -ne $Result.PSObject.Properties[$name]) { $command.$name = $Result.$name }
    }
    $command.reason = $null
    return $command
}

function Get-FoundationArtifactRecords {
    $sharedRoot = Split-Path -Parent $script:FoundationValidationCoreDirectory
    $projectRoot = Split-Path -Parent $sharedRoot
    $records = @(
        [pscustomobject]@{ artifact_id = "validator"; path = Join-Path $sharedRoot "validate-foundations.ps1" },
        [pscustomobject]@{ artifact_id = "core"; path = $script:FoundationValidationCorePath },
        [pscustomobject]@{ artifact_id = "validate_data_manifests"; path = Join-Path $sharedRoot "tests\validate-data-manifests.ps1" },
        [pscustomobject]@{ artifact_id = "validate_foundations_state_isolation"; path = Join-Path $sharedRoot "tests\validate-foundations-state-isolation.ps1" },
        [pscustomobject]@{ artifact_id = "contract"; path = Join-Path $projectRoot "docs\work-items\SH-SAFE-BASE-001-brief.md" }
    )
    foreach ($record in $records) {
        $record.path = Get-FoundationFullPath $record.path
        $record | Add-Member -NotePropertyName sha256 -NotePropertyValue (Get-FoundationCachedFileHash $record.path)
    }
    return @($records)
}

function Write-FoundationAtomicBytes {
    param(
        $Record,
        [AllowNull()][scriptblock]$PathPhaseObserver = $null,
        [AllowNull()][string]$PathOperationId = $null
    )
    Assert-FoundationExactPropertySet -Object $Record -Expected @("artifact_id", "artifact_kind", "temporary_path", "requested_path", "expected_sha256", "bytes") -ErrorCode "PUBLISHER_RECORD_INVALID"
    if (-not ($Record.bytes -is [byte[]])) { throw "PUBLISHER_RECORD_BYTES_INVALID" }
    $bytes = [byte[]]$Record.bytes
    $expectedHash = [string]$Record.expected_sha256
    if ($expectedHash -notmatch '^[A-F0-9]{64}$' -or (Get-FoundationSha256Bytes $bytes) -cne $expectedHash) { throw "PUBLISHER_RECORD_HASH_INVALID" }
    $target = Get-FoundationFullPath ([string]$Record.requested_path)
    $temporary = Get-FoundationFullPath ([string]$Record.temporary_path)
    $directory = Get-FoundationLexicalParentPath $target
    if (-not (Get-FoundationLexicalParentPath $temporary).Equals($directory, [System.StringComparison]::OrdinalIgnoreCase) -or
        $temporary.Equals($target, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "PUBLISHER_RECORD_PATH_INVALID"
    }
    $targetState = Get-FoundationNativePathState -Path $target -ShareWrite $true
    if ([bool]$targetState.exists) {
        $targetState.handle.Dispose()
        throw "REPORT_TARGET_ALREADY_EXISTS:$target"
    }
    $parentPins = New-FoundationPinnedPathChain -Path $directory -ShareWrite $true -AllowMissing $false
    $parentPin = @($parentPins.pins | Where-Object { ([string]$_.path).Equals($directory, [System.StringComparison]::OrdinalIgnoreCase) })[-1]
    $renameParentHandle = $null
    $handle = $null
    $published = $false
    try {
        if ($null -eq $parentPin -or $null -eq $parentPin.handle) { throw "REPORT_TARGET_PARENT_IDENTITY_INVALID:$directory" }
        $renameParentHandle = [FoundationValidationNativePath]::OpenRenameParent($directory)
        $renameParentInfo = [FoundationValidationNativePath]::GetInfo($renameParentHandle)
        $renameParentFinal = ConvertFrom-FoundationFinalHandlePath ([string]$renameParentInfo.FinalPath)
        if (-not $renameParentFinal.Equals($directory, [System.StringComparison]::OrdinalIgnoreCase) -or
            ($renameParentInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -eq 0 -or
            ($renameParentInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0 -or
            [string]$renameParentInfo.VolumeSerial -cne [string]$parentPin.volume_serial -or [string]$renameParentInfo.FileId -cne [string]$parentPin.file_id) {
            throw "REPORT_TARGET_PARENT_IDENTITY_INVALID:$directory"
        }
        $handle = [FoundationValidationNativePath]::CreateNewPinnedFile($temporary)
        $beforeInfo = [FoundationValidationNativePath]::GetInfo($handle)
        $beforeFinal = ConvertFrom-FoundationFinalHandlePath ([string]$beforeInfo.FinalPath)
        if (-not $beforeFinal.Equals($temporary, [System.StringComparison]::OrdinalIgnoreCase) -or
            ($beforeInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0 -or
            ($beforeInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0) {
            throw "PUBLISHER_TEMP_IDENTITY_INVALID"
        }
        [FoundationValidationNativePath]::WriteAll($handle, $bytes)
        $writtenInfo = [FoundationValidationNativePath]::GetInfo($handle)
        $writtenHash = [FoundationValidationNativePath]::Sha256($handle)
        if ([long]$writtenInfo.Length -ne [long]$bytes.LongLength -or $writtenHash -cne $expectedHash -or
            [string]$writtenInfo.VolumeSerial -cne [string]$beforeInfo.VolumeSerial -or [string]$writtenInfo.FileId -cne [string]$beforeInfo.FileId) {
            throw "PUBLISHER_TEMP_CONTENT_INVALID"
        }
        if (-not [string]::IsNullOrWhiteSpace($PathOperationId)) {
            $temporaryPin = [pscustomobject][ordered]@{
                path = $temporary; volume_serial = [string]$writtenInfo.VolumeSerial; file_id = [string]$writtenInfo.FileId
                attributes = [uint32]$writtenInfo.Attributes; share_write = $true; share_delete = $false; handle = $handle
            }
            Invoke-FoundationPathPhaseObserver -Observer $PathPhaseObserver -Phase "evidence_after_temp_write_before_rename" -OperationId $PathOperationId -PinnedPaths (@($parentPins.pins) + @($temporaryPin)) -TargetPath $target
        }
        $finalLeaf = $target.Substring($directory.TrimEnd("\").Length + 1)
        [FoundationValidationNativePath]::RenameRelativeNoReplace($handle, $renameParentHandle, $finalLeaf)
        $finalInfo = [FoundationValidationNativePath]::GetInfo($handle)
        $finalPath = ConvertFrom-FoundationFinalHandlePath ([string]$finalInfo.FinalPath)
        $finalHash = [FoundationValidationNativePath]::Sha256($handle)
        if (-not $finalPath.Equals($target, [System.StringComparison]::OrdinalIgnoreCase) -or
            [long]$finalInfo.Length -ne [long]$bytes.LongLength -or $finalHash -cne $expectedHash -or
            [string]$finalInfo.VolumeSerial -cne [string]$beforeInfo.VolumeSerial -or [string]$finalInfo.FileId -cne [string]$beforeInfo.FileId) {
            throw "PUBLISHER_FINAL_IDENTITY_INVALID"
        }
        $published = $true
        return [pscustomobject][ordered]@{
            requested_path = $target; temporary_path = $temporary; published_path = $target
            sha256 = $finalHash; length = [long]$finalInfo.Length
            volume_serial = [string]$finalInfo.VolumeSerial; file_id = [string]$finalInfo.FileId
        }
    }
    catch {
        $originalError = $_.Exception.ToString()
        $cleanupError = $null
        if ($null -ne $handle) {
            try { [FoundationValidationNativePath]::MarkDelete($handle) }
            catch { $cleanupError = $_.Exception.ToString() }
        }
        if ([string]::IsNullOrWhiteSpace($cleanupError)) { throw $originalError }
        throw ($originalError + " | PUBLISHER_TEMP_CLEANUP_FAILED:" + $cleanupError)
    }
    finally {
        if ($null -ne $handle) { $handle.Dispose() }
        if ($null -ne $renameParentHandle) { $renameParentHandle.Dispose() }
        Close-FoundationPinSet $parentPins
    }
}

function New-FoundationPublicationArtifactResult {
    param(
        [string]$ArtifactId,
        [string]$ArtifactKind,
        [string]$RequestedPath,
        [AllowNull()]$PublishedPath,
        [string]$Status,
        [AllowNull()]$Sha256,
        [AllowNull()]$ErrorType,
        [AllowNull()]$ErrorText
    )
    return [pscustomobject][ordered]@{
        artifact_id = $ArtifactId
        artifact_kind = $ArtifactKind
        requested_path = $RequestedPath
        published_path = $PublishedPath
        status = $Status
        sha256 = $Sha256
        error_type = $ErrorType
        error_text = $ErrorText
    }
}

function Copy-FoundationPublisherPlainDtoMap {
    param(
        [AllowNull()]$Value,
        [Parameter(Mandatory = $true)][string[]]$Expected
    )
    $errorCode = "PUBLISHER_RESULT_INVALID"
    try {
        if ($null -eq $Value) { throw $errorCode }
        $expectedNames = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($expectedName in $Expected) {
            if ([string]::IsNullOrWhiteSpace($expectedName) -or -not $expectedNames.Add($expectedName)) { throw $errorCode }
        }
        $actualNames = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
        $map = New-Object System.Collections.Hashtable ([System.StringComparer]::OrdinalIgnoreCase)
        if ($Value -is [System.Management.Automation.PSCustomObject]) {
            $properties = @($Value.PSObject.Properties)
            foreach ($property in $properties) {
                if ($property.MemberType -ne [System.Management.Automation.PSMemberTypes]::NoteProperty -or
                    [string]::IsNullOrWhiteSpace([string]$property.Name) -or
                    -not $actualNames.Add([string]$property.Name)) {
                    throw $errorCode
                }
            }
            if ($actualNames.Count -ne $expectedNames.Count) { throw $errorCode }
            foreach ($expectedName in $Expected) {
                if (-not $actualNames.Contains($expectedName)) { throw $errorCode }
            }
            foreach ($property in $properties) {
                [void]$map.Add([string]$property.Name, $property.Value)
            }
            return $map
        }

        $valueType = [System.Object].GetMethod("GetType").Invoke($Value, $null)
        if ($valueType -eq [System.Collections.Hashtable] -or $valueType -eq [System.Collections.Specialized.OrderedDictionary]) {
            foreach ($property in @($Value.PSObject.Properties)) {
                if ($property.MemberType -ne [System.Management.Automation.PSMemberTypes]::Property) { throw $errorCode }
            }
            $dictionaryKeysProperty = [System.Collections.IDictionary].GetProperty("Keys")
            $dictionaryItemProperty = [System.Collections.IDictionary].GetProperty("Item")
            $keys = @($dictionaryKeysProperty.GetValue($Value, $null))
            foreach ($key in $keys) {
                if (-not ($key -is [string]) -or [string]::IsNullOrWhiteSpace([string]$key) -or -not $actualNames.Add([string]$key)) {
                    throw $errorCode
                }
            }
            if ($actualNames.Count -ne $expectedNames.Count) { throw $errorCode }
            foreach ($expectedName in $Expected) {
                if (-not $actualNames.Contains($expectedName)) { throw $errorCode }
            }
            foreach ($key in $keys) {
                [void]$map.Add([string]$key, $dictionaryItemProperty.GetValue($Value, @([object]$key)))
            }
            return $map
        }
        throw $errorCode
    }
    catch {
        throw $errorCode
    }
}

function Copy-FoundationPublisherPlainCollection {
    param([AllowNull()]$Value)
    $errorCode = "PUBLISHER_RESULT_INVALID"
    try {
        if ($null -eq $Value) { throw $errorCode }
        $items = New-Object System.Collections.ArrayList
        if ($Value -is [System.Array]) {
            $rank = [int][System.Array].GetProperty("Rank").GetValue($Value, $null)
            if ($rank -ne 1) { throw $errorCode }
            $getLowerBound = [System.Array].GetMethod("GetLowerBound", [type[]]@([int]))
            $getUpperBound = [System.Array].GetMethod("GetUpperBound", [type[]]@([int]))
            $getValue = [System.Array].GetMethod("GetValue", [type[]]@([int]))
            $lower = [int]$getLowerBound.Invoke($Value, @([object]0))
            $upper = [int]$getUpperBound.Invoke($Value, @([object]0))
            for ($index = $lower; $index -le $upper; $index++) {
                [void]$items.Add($getValue.Invoke($Value, @([object]$index)))
            }
            return @($items)
        }
        $valueType = [System.Object].GetMethod("GetType").Invoke($Value, $null)
        if ($valueType -eq [System.Collections.ArrayList]) {
            $countProperty = [System.Collections.ICollection].GetProperty("Count")
            $itemProperty = [System.Collections.IList].GetProperty("Item")
            $count = [int]$countProperty.GetValue($Value, $null)
            for ($index = 0; $index -lt $count; $index++) {
                [void]$items.Add($itemProperty.GetValue($Value, @([object]$index)))
            }
            return @($items)
        }
        throw $errorCode
    }
    catch {
        throw $errorCode
    }
}

function Copy-FoundationPublisherResultPlainDto {
    param([AllowNull()]$Value)
    $errorCode = "PUBLISHER_RESULT_INVALID"
    try {
        $top = Copy-FoundationPublisherPlainDtoMap -Value $Value -Expected @("success", "json_path", "json_sha256", "artifact_results")
        if (-not ($top["success"] -is [bool])) { throw $errorCode }
        foreach ($name in @("json_path", "json_sha256")) {
            if ($null -ne $top[$name] -and -not ($top[$name] -is [string])) { throw $errorCode }
        }
        $artifactClones = New-Object System.Collections.ArrayList
        foreach ($artifactValue in @(Copy-FoundationPublisherPlainCollection -Value $top["artifact_results"])) {
            $artifact = Copy-FoundationPublisherPlainDtoMap -Value $artifactValue -Expected @("artifact_id", "artifact_kind", "requested_path", "published_path", "status", "sha256", "error_type", "error_text")
            foreach ($name in @("artifact_id", "artifact_kind", "requested_path", "status")) {
                if (-not ($artifact[$name] -is [string])) { throw $errorCode }
            }
            foreach ($name in @("published_path", "sha256", "error_type", "error_text")) {
                if ($null -ne $artifact[$name] -and -not ($artifact[$name] -is [string])) { throw $errorCode }
            }
            [void]$artifactClones.Add([pscustomobject][ordered]@{
                artifact_id = [string]$artifact["artifact_id"]
                artifact_kind = [string]$artifact["artifact_kind"]
                requested_path = [string]$artifact["requested_path"]
                published_path = if ($null -eq $artifact["published_path"]) { $null } else { [string]$artifact["published_path"] }
                status = [string]$artifact["status"]
                sha256 = if ($null -eq $artifact["sha256"]) { $null } else { [string]$artifact["sha256"] }
                error_type = if ($null -eq $artifact["error_type"]) { $null } else { [string]$artifact["error_type"] }
                error_text = if ($null -eq $artifact["error_text"]) { $null } else { [string]$artifact["error_text"] }
            })
        }
        return [pscustomobject][ordered]@{
            success = [bool]$top["success"]
            json_path = if ($null -eq $top["json_path"]) { $null } else { [string]$top["json_path"] }
            json_sha256 = if ($null -eq $top["json_sha256"]) { $null } else { [string]$top["json_sha256"] }
            artifact_results = @($artifactClones)
        }
    }
    catch {
        throw $errorCode
    }
}

function Get-FoundationPublicationPathObservation {
    param([Parameter(Mandatory = $true)][string]$Path)
    $full = Get-FoundationFullPath $Path
    $parent = Get-FoundationLexicalParentPath $full
    $parentPins = New-FoundationPinnedPathChain -Path $parent -ShareWrite $false -AllowMissing $true
    $handle = $null
    try {
        if (@($parentPins.missing_paths).Count -gt 0) { return [pscustomobject][ordered]@{ exists = $false; path = $full; length = $null; sha256 = $null; volume_serial = $null; file_id = $null } }
        $openError = 0
        $handle = [FoundationValidationNativePath]::TryOpenReadNoFollow($full, [ref]$openError)
        if ($null -eq $handle) {
            if ($openError -in @(2, 3)) { return [pscustomobject][ordered]@{ exists = $false; path = $full; length = $null; sha256 = $null; volume_serial = $null; file_id = $null } }
            throw "PATH_OPERATION_FAILED:publication_open:${full}:$openError"
        }
        $info = [FoundationValidationNativePath]::GetInfo($handle)
        $final = ConvertFrom-FoundationFinalHandlePath ([string]$info.FinalPath)
        if (-not $final.Equals($full, [System.StringComparison]::OrdinalIgnoreCase) -or
            ($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0 -or
            ($info.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0) {
            throw "PATH_IDENTITY_CHANGED:$full"
        }
        return [pscustomobject][ordered]@{
            exists = $true; path = $full; length = [long]$info.Length; sha256 = [FoundationValidationNativePath]::Sha256($handle)
            volume_serial = [string]$info.VolumeSerial; file_id = [string]$info.FileId
        }
    }
    finally {
        if ($null -ne $handle) { $handle.Dispose() }
        Close-FoundationPinSet $parentPins
    }
}

function Get-FoundationPublicationTemporaryArtifactResidual {
    param([Parameter(Mandatory = $true)][string]$Path)
    $full = Get-FoundationFullPath $Path
    try {
        $observation = Get-FoundationPublicationPathObservation -Path $full
        if (-not [bool]$observation.exists) {
            return [pscustomobject][ordered]@{ attempted = $false; succeeded = $true; residual_count = 0; error_type = $null; error_text = $null }
        }
        return [pscustomobject][ordered]@{
            attempted = $false
            succeeded = $false
            residual_count = 1
            error_type = "PUBLISHER_TEMP_IDENTITY_UNOWNED"
            error_text = "Preregistered temporary path is occupied, but no publisher-created handle identity authorizes deletion"
        }
    }
    catch {
        return [pscustomobject][ordered]@{
            attempted = $false
            succeeded = $false
            residual_count = 1
            error_type = $_.Exception.GetType().FullName
            error_text = $_.Exception.ToString()
        }
    }
}

function Invoke-FoundationDefaultReportPublisher {
    param($Request, [AllowNull()][scriptblock]$PathPhaseObserver = $null)
    Assert-FoundationExactPropertySet -Object $Request -Expected @("json_record", "raw_records") -ErrorCode "PUBLISHER_REQUEST_INVALID"
    $jsonRecord = $Request.json_record
    Assert-FoundationExactPropertySet -Object $jsonRecord -Expected @("artifact_id", "artifact_kind", "temporary_path", "requested_path", "expected_sha256", "bytes") -ErrorCode "PUBLISHER_JSON_RECORD_INVALID"
    if ([string]$jsonRecord.artifact_id -cne "machine_json" -or [string]$jsonRecord.artifact_kind -cne "machine_json") { throw "PUBLISHER_JSON_RECORD_INVALID" }
    $jsonPath = Get-FoundationFullPath ([string]$jsonRecord.requested_path)
    $jsonTemporaryPath = Get-FoundationFullPath ([string]$jsonRecord.temporary_path)
    $evidenceDirectory = Get-FoundationLexicalParentPath $jsonPath
    if (-not (Get-FoundationLexicalParentPath $jsonTemporaryPath).Equals($evidenceDirectory, [System.StringComparison]::OrdinalIgnoreCase)) { throw "PUBLISHER_JSON_RECORD_INVALID" }
    $evidencePins = New-FoundationPinnedPathChain -Path $evidenceDirectory -ShareWrite $true -AllowMissing $false
    Close-FoundationPinSet $evidencePins
    $validatedRaw = New-Object System.Collections.ArrayList
    $seenIds = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    $seenPaths = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    [void]$seenIds.Add("machine_json")
    [void]$seenPaths.Add($jsonPath)
    if (-not $seenPaths.Add($jsonTemporaryPath)) { throw "PUBLISHER_RECORD_PATH_REUSED:$jsonTemporaryPath" }
    $rawDirectory = $null
    foreach ($record in @($Request.raw_records)) {
        Assert-FoundationExactPropertySet -Object $record -Expected @("artifact_id", "artifact_kind", "temporary_path", "requested_path", "expected_sha256", "bytes") -ErrorCode "PUBLISHER_RAW_RECORD_INVALID"
        $artifactId = [string]$record.artifact_id
        $artifactKind = [string]$record.artifact_kind
        if ([string]::IsNullOrWhiteSpace($artifactId) -or [string]::IsNullOrWhiteSpace($artifactKind) -or -not $seenIds.Add($artifactId)) { throw "PUBLISHER_RAW_RECORD_IDENTITY_INVALID:$artifactId" }
        if (-not ($record.bytes -is [byte[]]) -or [string]$record.expected_sha256 -notmatch '^[A-F0-9]{64}$' -or
            (Get-FoundationSha256Bytes ([byte[]]$record.bytes)) -cne [string]$record.expected_sha256) { throw "PUBLISHER_RAW_RECORD_BYTES_INVALID:$artifactId" }
        $requestedPath = Get-FoundationFullPath ([string]$record.requested_path)
        $temporaryPath = Get-FoundationFullPath ([string]$record.temporary_path)
        $recordDirectory = Get-FoundationLexicalParentPath $requestedPath
        if (-not (Get-FoundationLexicalParentPath $temporaryPath).Equals($recordDirectory, [System.StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-FoundationPathContained -Parent $evidenceDirectory -Candidate $recordDirectory) -or
            -not (Get-FoundationLexicalParentPath $recordDirectory).Equals($evidenceDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "PUBLISHER_RAW_RECORD_OUTSIDE_RAW_DIRECTORY:$artifactId"
        }
        if ($null -eq $rawDirectory) { $rawDirectory = $recordDirectory }
        elseif (-not $rawDirectory.Equals($recordDirectory, [System.StringComparison]::OrdinalIgnoreCase)) { throw "PUBLISHER_RAW_DIRECTORY_REUSED" }
        if (-not $seenPaths.Add($requestedPath) -or -not $seenPaths.Add($temporaryPath)) { throw "PUBLISHER_RAW_RECORD_PATH_REUSED:$artifactId" }
        [void]$validatedRaw.Add($record)
    }
    if (-not ($jsonRecord.bytes -is [byte[]]) -or [string]$jsonRecord.expected_sha256 -notmatch '^[A-F0-9]{64}$' -or
        (Get-FoundationSha256Bytes ([byte[]]$jsonRecord.bytes)) -cne [string]$jsonRecord.expected_sha256) { throw "PUBLISHER_JSON_RECORD_BYTES_INVALID" }
    foreach ($path in @($seenPaths)) {
        $state = Get-FoundationNativePathState -Path ([string]$path) -ShareWrite $true
        if ([bool]$state.exists) { $state.handle.Dispose(); throw "REPORT_TARGET_ALREADY_EXISTS:$path" }
    }
    if ($null -ne $rawDirectory) {
        $rawPins = New-FoundationPinnedDirectory -Path $rawDirectory -OperationId "evidence_raw_directory"
        Close-FoundationPinSet $rawPins
    }
    $artifactResults = New-Object System.Collections.ArrayList
    $failures = New-Object System.Collections.ArrayList
    foreach ($record in @($validatedRaw)) {
        $artifactId = [string]$record.artifact_id
        $artifactKind = [string]$record.artifact_kind
        $requestedPath = Get-FoundationFullPath ([string]$record.requested_path)
        try {
            $published = Write-FoundationAtomicBytes -Record $record -PathPhaseObserver $PathPhaseObserver -PathOperationId ("evidence_publish:" + $artifactId)
            $hash = [string]$published.sha256
            [void]$artifactResults.Add((New-FoundationPublicationArtifactResult $artifactId $artifactKind $requestedPath $requestedPath "published" $hash $null $null))
        }
        catch {
            $message = $_.Exception.ToString()
            [void]$failures.Add($message)
            [void]$artifactResults.Add((New-FoundationPublicationArtifactResult $artifactId $artifactKind $requestedPath $null "not_published" $null "PUBLISHER_ARTIFACT_WRITE_FAILED" $message))
        }
    }
    $jsonHash = $null
    try {
        $jsonPublished = Write-FoundationAtomicBytes -Record $jsonRecord -PathPhaseObserver $PathPhaseObserver -PathOperationId "evidence_publish:machine_json"
        $jsonHash = [string]$jsonPublished.sha256
        [void]$artifactResults.Add((New-FoundationPublicationArtifactResult "machine_json" "machine_json" $jsonPath $jsonPath "published" $jsonHash $null $null))
    }
    catch {
        $message = $_.Exception.ToString()
        [void]$failures.Add($message)
        [void]$artifactResults.Add((New-FoundationPublicationArtifactResult "machine_json" "machine_json" $jsonPath $null "not_published" $null "PUBLISHER_ARTIFACT_WRITE_FAILED" $message))
    }
    $success = $failures.Count -eq 0
    return [pscustomobject][ordered]@{
        success = $success
        json_path = if ($success) { $jsonPath } else { $null }
        json_sha256 = if ($success) { $jsonHash } else { $null }
        artifact_results = @($artifactResults)
    }
}

function Get-FoundationPublicationReview {
    param(
        [object[]]$Artifacts,
        [AllowNull()]$PublisherResult,
        [AllowNull()][string]$PublisherError
    )
    $overallSuccess = $false
    $adapterResults = @()
    if ($null -ne $PublisherResult) {
        $publisherSnapshot = Copy-FoundationPublisherResultPlainDto -Value $PublisherResult
        $overallSuccess = [bool]$publisherSnapshot.success
        $adapterResults = @($publisherSnapshot.artifact_results)
    }
    $finalArtifacts = New-Object System.Collections.ArrayList
    $temporaryArtifacts = New-Object System.Collections.ArrayList
    $actualRawPaths = New-Object System.Collections.ArrayList
    $actualRawHashes = New-Object System.Collections.ArrayList
    $reviewErrors = New-Object System.Collections.ArrayList
    foreach ($expected in @($Artifacts)) {
        $requestedPath = Get-FoundationFullPath ([string]$expected.requested_path)
        $temporaryPath = Get-FoundationFullPath ([string]$expected.temporary_path)
        $observation = $null
        $physicalError = $null
        try { $observation = Get-FoundationPublicationPathObservation -Path $requestedPath }
        catch {
            $physicalError = $_.Exception.ToString()
            $observation = [pscustomobject]@{ exists = $false; path = $requestedPath; length = $null; sha256 = $null }
        }
        if ([bool]$observation.exists -and [string]$expected.artifact_kind -cne "machine_json") {
            [void]$actualRawPaths.Add($requestedPath)
            [void]$actualRawHashes.Add([string]$observation.sha256)
        }
        $matches = @($adapterResults | Where-Object { $null -ne $_ -and [string]$_.artifact_id -ceq [string]$expected.artifact_id })
        $confirmed = $false
        $adapterErrorType = $null
        $adapterErrorText = $null
        if ($matches.Count -eq 1) {
            $candidate = $matches[0]
            try {
                Assert-FoundationExactPropertySet -Object $candidate -Expected @("artifact_id", "artifact_kind", "requested_path", "published_path", "status", "sha256", "error_type", "error_text") -ErrorCode "PUBLISHER_RESULT_INVALID"
                $adapterErrorType = if ($null -eq $candidate.error_type) { $null } else { [string]$candidate.error_type }
                $adapterErrorText = if ($null -eq $candidate.error_text) { $null } else { [string]$candidate.error_text }
                $candidateRequested = Get-FoundationFullPath ([string]$candidate.requested_path)
                $candidatePublished = Get-FoundationFullPath ([string]$candidate.published_path)
                $confirmed = [string]$candidate.status -ceq "published" -and [string]$candidate.artifact_kind -ceq [string]$expected.artifact_kind -and
                    $candidateRequested.Equals($requestedPath, [System.StringComparison]::OrdinalIgnoreCase) -and
                    $candidatePublished.Equals($requestedPath, [System.StringComparison]::OrdinalIgnoreCase) -and
                    [string]$candidate.sha256 -ceq [string]$expected.expected_sha256 -and [bool]$observation.exists -and
                    [string]$observation.sha256 -ceq [string]$expected.expected_sha256 -and [long]$observation.length -eq [long]$expected.expected_length
            }
            catch { $confirmed = $false; if ([string]::IsNullOrWhiteSpace($adapterErrorText)) { $adapterErrorText = $_.Exception.ToString() } }
        }
        if ([string]$expected.artifact_kind -ceq "machine_json" -and -not $overallSuccess) { $confirmed = $false }
        if ($confirmed) {
            [void]$finalArtifacts.Add((New-FoundationPublicationArtifactResult ([string]$expected.artifact_id) ([string]$expected.artifact_kind) $requestedPath $requestedPath "published" ([string]$observation.sha256) $null $null))
        }
        elseif ([bool]$observation.exists) {
            if ([string]::IsNullOrWhiteSpace($adapterErrorType)) { $adapterErrorType = "PUBLISHER_RESULT_UNCONFIRMED" }
            $reason = if ([string]::IsNullOrWhiteSpace($adapterErrorText)) { "Publisher result did not uniquely confirm the preregistered artifact" } else { $adapterErrorText }
            if (-not [string]::IsNullOrWhiteSpace($PublisherError) -and $reason -notmatch [regex]::Escape($PublisherError)) { $reason += " | " + $PublisherError }
            if (-not [string]::IsNullOrWhiteSpace($physicalError)) { $reason += " | " + $physicalError }
            [void]$finalArtifacts.Add((New-FoundationPublicationArtifactResult ([string]$expected.artifact_id) ([string]$expected.artifact_kind) $requestedPath $requestedPath "partial_unconfirmed" ([string]$observation.sha256) $adapterErrorType $reason))
        }
        else {
            if ([string]::IsNullOrWhiteSpace($adapterErrorType)) { $adapterErrorType = "PUBLISHER_ARTIFACT_NOT_PUBLISHED" }
            $reason = if ([string]::IsNullOrWhiteSpace($adapterErrorText)) { "Preregistered artifact was not published" } else { $adapterErrorText }
            if (-not [string]::IsNullOrWhiteSpace($PublisherError) -and $reason -notmatch [regex]::Escape($PublisherError)) { $reason += " | " + $PublisherError }
            if (-not [string]::IsNullOrWhiteSpace($physicalError)) { $reason += " | " + $physicalError }
            [void]$finalArtifacts.Add((New-FoundationPublicationArtifactResult ([string]$expected.artifact_id) ([string]$expected.artifact_kind) $requestedPath $null "not_published" $null $adapterErrorType $reason))
        }
        $tempCleanup = Get-FoundationPublicationTemporaryArtifactResidual -Path $temporaryPath
        [void]$temporaryArtifacts.Add([pscustomobject][ordered]@{ artifact_id = [string]$expected.artifact_id; temp_path = $temporaryPath; cleanup = $tempCleanup })
        if (-not [bool]$tempCleanup.succeeded -or -not [string]::IsNullOrWhiteSpace([string]$tempCleanup.error_text)) {
            [void]$reviewErrors.Add([pscustomobject][ordered]@{ code = "report_publish_failed"; category = "report"; artifact_id = [string]$expected.artifact_id; message = [string]$tempCleanup.error_text })
        }
    }
    $publishedCount = @($finalArtifacts | Where-Object { [string]$_.status -ceq "published" }).Count
    $physicalFinalCount = @($finalArtifacts | Where-Object { $null -ne $_.published_path }).Count
    $evidenceResidualCount = [int](@($temporaryArtifacts | Where-Object { [int]$_.cleanup.residual_count -gt 0 }).Count)
    $status = "failed"
    if ($overallSuccess -and $publishedCount -eq @($Artifacts).Count -and $evidenceResidualCount -eq 0) { $status = "complete" }
    elseif ($physicalFinalCount -gt 0 -or $evidenceResidualCount -gt 0) { $status = "partial" }
    return [pscustomobject][ordered]@{
        publication = [pscustomobject][ordered]@{ status = $status; artifacts = @($finalArtifacts); temporary_artifacts = @($temporaryArtifacts); evidence_residual_count = $evidenceResidualCount }
        raw_paths = @($actualRawPaths)
        raw_sha256 = @($actualRawHashes)
        review_errors = @($reviewErrors)
    }
}

function New-FoundationPublicationPreparation {
    param(
        $Report,
        [string]$EvidenceRoot,
        [string]$RunId,
        [AllowNull()]$PathSecurityState = $null
    )
    if ($null -ne $Report.PSObject.Properties["publication"] -or $null -ne $Report.PSObject.Properties["json_sha256"]) {
        throw "REPORT_SNAPSHOT_ALREADY_CONTAINS_PUBLICATION_RESULT"
    }
    if (-not (Test-FoundationRunId $RunId)) { throw "REPORT_RUN_ID_INVALID" }
    $evidence = Get-FoundationFullPath $EvidenceRoot
    $rawDirectoryResolution = Resolve-FoundationChildPath -TrustedParent $evidence -CandidateRelativePath "raw" -ExpectedLeaf "raw"
    if (-not [bool]$rawDirectoryResolution.allowed) {
        throw ("REPORT_RAW_DIRECTORY_INVALID:" + [string]$rawDirectoryResolution.error_code)
    }
    $rawDirectory = [string]$rawDirectoryResolution.full_path
    $jsonLeaf = "SH-SAFE-BASE-001-" + $RunId + ".json"
    $jsonResolution = Resolve-FoundationChildPath -TrustedParent $evidence -CandidateRelativePath $jsonLeaf -ExpectedLeaf $jsonLeaf
    if (-not [bool]$jsonResolution.allowed) {
        throw ("REPORT_JSON_PATH_INVALID:" + [string]$jsonResolution.error_code)
    }
    $jsonPath = [string]$jsonResolution.full_path
    $rawRecords = New-Object System.Collections.ArrayList
    $rawPlans = New-Object System.Collections.ArrayList
    $artifacts = New-Object System.Collections.ArrayList
    $rawPaths = New-Object System.Collections.ArrayList
    $rawHashes = New-Object System.Collections.ArrayList
    $seenArtifactIds = @{}
    $seenPaths = @{}
    $channelSpecs = @(
        [pscustomobject]@{ name = "stdout"; text_field = "stdout"; path_field = "stdout_raw_path"; hash_field = "stdout_sha256"; artifact_kind = "stdout_raw" },
        [pscustomobject]@{ name = "stderr"; text_field = "stderr"; path_field = "stderr_raw_path"; hash_field = "stderr_sha256"; artifact_kind = "stderr_raw" },
        [pscustomobject]@{ name = "exception"; text_field = "exception_text"; path_field = "exception_raw_path"; hash_field = "exception_sha256"; artifact_kind = "exception_raw" }
    )
    foreach ($command in @($Report.commands)) {
        $commandId = [string]$command.id
        $safeId = $commandId -replace '[^A-Za-z0-9.-]', '_'
        foreach ($channel in $channelSpecs) {
            $artifactId = $commandId + "." + [string]$channel.name
            if ($seenArtifactIds.ContainsKey($artifactId)) { throw "REPORT_ARTIFACT_ID_REUSED:$artifactId" }
            $leaf = "SH-SAFE-BASE-001-" + $RunId + "-" + $safeId + "-" + [string]$channel.name + ".txt"
            $relative = Join-Path "raw" $leaf
            $pathResolution = Resolve-FoundationChildPath -TrustedParent $evidence -CandidateRelativePath $relative -ExpectedLeaf $leaf
            if (-not [bool]$pathResolution.allowed) {
                throw ("REPORT_ARTIFACT_PATH_INVALID:" + [string]$pathResolution.error_code)
            }
            $path = [string]$pathResolution.full_path
            $pathKey = $path.ToUpperInvariant()
            if ($seenPaths.ContainsKey($pathKey)) { throw "REPORT_ARTIFACT_PATH_REUSED:$path" }
            $temporaryLeaf = "." + $leaf + "." + [guid]::NewGuid().ToString("N") + ".tmp"
            $temporaryRelative = Join-Path "raw" $temporaryLeaf
            $temporaryResolution = Resolve-FoundationChildPath -TrustedParent $evidence -CandidateRelativePath $temporaryRelative -ExpectedLeaf $temporaryLeaf
            if (-not [bool]$temporaryResolution.allowed) { throw ("REPORT_ARTIFACT_TEMP_PATH_INVALID:" + [string]$temporaryResolution.error_code) }
            $temporaryPath = [string]$temporaryResolution.full_path
            $temporaryKey = $temporaryPath.ToUpperInvariant()
            if ($seenPaths.ContainsKey($temporaryKey) -or $temporaryPath.Equals($path, [System.StringComparison]::OrdinalIgnoreCase)) { throw "REPORT_ARTIFACT_PATH_REUSED:$temporaryPath" }
            $text = [string]$command.PSObject.Properties[[string]$channel.text_field].Value
            $bytes = [byte[]]$script:FoundationUtf8NoBom.GetBytes($text)
            $hash = Get-FoundationSha256Bytes $bytes
            $command.PSObject.Properties[[string]$channel.path_field].Value = $path
            $command.PSObject.Properties[[string]$channel.hash_field].Value = $hash
            [void]$rawRecords.Add([pscustomobject][ordered]@{
                artifact_id = $artifactId
                artifact_kind = [string]$channel.artifact_kind
                temporary_path = $temporaryPath
                requested_path = $path
                expected_sha256 = $hash
                bytes = $bytes
            })
            [void]$rawPlans.Add([pscustomobject][ordered]@{
                artifact_id = $artifactId
                artifact_kind = [string]$channel.artifact_kind
                temporary_path = $temporaryPath
                requested_path = $path
                expected_sha256 = $hash
            })
            [void]$artifacts.Add([pscustomobject][ordered]@{
                artifact_id = $artifactId
                artifact_kind = [string]$channel.artifact_kind
                temporary_path = $temporaryPath
                requested_path = $path
                expected_sha256 = $hash
                expected_length = [long]$bytes.Length
            })
            [void]$rawPaths.Add($path)
            [void]$rawHashes.Add($hash)
            $seenArtifactIds[$artifactId] = $true
            $seenPaths[$pathKey] = $true
            $seenPaths[$temporaryKey] = $true
        }
    }
    $Report.raw_paths = @($rawPaths)
    if ($null -eq $Report.PSObject.Properties["raw_sha256"]) {
        $Report | Add-Member -NotePropertyName raw_sha256 -NotePropertyValue @($rawHashes)
    }
    else {
        $Report.raw_sha256 = @($rawHashes)
    }
    $Report.report_path = $jsonPath
    $jsonTemporaryLeaf = "." + $jsonLeaf + "." + [guid]::NewGuid().ToString("N") + ".tmp"
    $jsonTemporaryResolution = Resolve-FoundationChildPath -TrustedParent $evidence -CandidateRelativePath $jsonTemporaryLeaf -ExpectedLeaf $jsonTemporaryLeaf
    if (-not [bool]$jsonTemporaryResolution.allowed) { throw ("REPORT_JSON_TEMP_PATH_INVALID:" + [string]$jsonTemporaryResolution.error_code) }
    $jsonTemporaryPath = [string]$jsonTemporaryResolution.full_path
    $jsonTemporaryKey = $jsonTemporaryPath.ToUpperInvariant()
    if ($seenPaths.ContainsKey($jsonTemporaryKey) -or $jsonTemporaryPath.Equals($jsonPath, [System.StringComparison]::OrdinalIgnoreCase)) { throw "REPORT_ARTIFACT_PATH_REUSED:$jsonTemporaryPath" }
    $jsonPathKey = $jsonPath.ToUpperInvariant()
    if ($seenPaths.ContainsKey($jsonPathKey)) { throw "REPORT_ARTIFACT_PATH_REUSED:$jsonPath" }
    $jsonPlan = [pscustomobject][ordered]@{
        artifact_id = "machine_json"
        artifact_kind = "machine_json"
        temporary_path = $jsonTemporaryPath
        requested_path = $jsonPath
        expected_sha256 = $null
    }
    $Report | Add-Member -NotePropertyName artifact_plan -NotePropertyValue ([pscustomobject][ordered]@{ json_record = $jsonPlan; raw_records = @($rawPlans) }) -Force
    if ($null -ne $PathSecurityState) {
        $evidencePins = New-FoundationPinnedPathChain -Path $evidence -ShareWrite $true -AllowMissing $false
        try {
            foreach ($rawRecord in @($rawRecords)) {
                [void](Add-FoundationPathSecurityOperation -State $PathSecurityState -OperationId ("evidence_publish:" + [string]$rawRecord.artifact_id) -OperationKind "evidence_publish" -Phase "pin" -PinnedPaths @($evidencePins.pins) -ImmutableInputCount 0 -Succeeded $true)
            }
            [void](Add-FoundationPathSecurityOperation -State $PathSecurityState -OperationId "evidence_publish:machine_json" -OperationKind "evidence_publish" -Phase "pin" -PinnedPaths @($evidencePins.pins) -ImmutableInputCount 0 -Succeeded $true)
        }
        finally {
            Close-FoundationPinSet $evidencePins
        }
        $Report.path_security = Get-FoundationPathSecurityReport $PathSecurityState
    }
    $machineJson = [string]($Report | ConvertTo-Json -Depth 32 -Compress)
    $machineBytes = [byte[]]$script:FoundationUtf8NoBom.GetBytes($machineJson)
    $machineHash = Get-FoundationSha256Bytes $machineBytes
    $machineArtifactId = "machine_json"
    if ($seenArtifactIds.ContainsKey($machineArtifactId)) { throw "REPORT_ARTIFACT_ID_REUSED:$machineArtifactId" }
    [void]$artifacts.Add([pscustomobject][ordered]@{
        artifact_id = $machineArtifactId
        artifact_kind = "machine_json"
        temporary_path = $jsonTemporaryPath
        requested_path = $jsonPath
        expected_sha256 = $machineHash
        expected_length = [long]$machineBytes.Length
    })
    return [pscustomobject]@{
        request = [pscustomobject][ordered]@{
            json_record = [pscustomobject][ordered]@{
                artifact_id = $machineArtifactId
                artifact_kind = "machine_json"
                temporary_path = $jsonTemporaryPath
                requested_path = $jsonPath
                expected_sha256 = $machineHash
                bytes = $machineBytes
            }
            raw_records = @($rawRecords)
        }
        artifacts = @($artifacts)
        expected_json_sha256 = $machineHash
    }
}

function New-FoundationFaultObject {
    param($PrimaryFault, [string]$PreHash, [string]$PostHash, $OfficialDiff, [bool]$AfterGenerated)
    $reasons = [pscustomobject][ordered]@{
        should_rollback = "not_business_transaction_or_restart_or_idempotency_test"
        state_after_restart = "not_business_transaction_or_restart_or_idempotency_test"
        same_key_retry_result = "not_business_transaction_or_restart_or_idempotency_test"
    }
    return [pscustomobject][ordered]@{
        failure_injection_point = [string]$PrimaryFault.injection
        pre_state_hash = $PreHash
        expected_error_code = [string]$PrimaryFault.code
        should_rollback = "NA"
        post_state_hash = $PostHash
        state_after_restart = "NA"
        same_key_retry_result = "NA"
        official_business_data_diff = $OfficialDiff
        observed_error_code = [string]$PrimaryFault.code
        after_manifest_generated = $AfterGenerated
        field_na_reasons = $reasons
    }
}

function New-FoundationInternalFailureRunId {
    return "internal-fallback-" + [guid]::NewGuid().ToString("N")
}

function Invoke-FoundationValidationCore {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string]$EvidenceRoot,
        [Parameter(Mandatory = $true)]$Runtime,
        [Parameter(Mandatory = $true)][scriptblock]$CommandRunner,
        [Parameter(Mandatory = $true)][scriptblock]$CleanupRunner,
        [Parameter(Mandatory = $true)][scriptblock]$EnvironmentAdapter,
        [AllowNull()][scriptblock]$ManifestProvider,
        [AllowNull()][scriptblock]$ReportPublisher,
        [AllowNull()][scriptblock]$PathPhaseObserver = $null,
        [Parameter(Mandatory = $true)][scriptblock]$Clock,
        [Parameter(Mandatory = $true)][scriptblock]$RunIdProvider
    )
    $taskId = "SH-SAFE-BASE-001"
    $errors = New-Object System.Collections.ArrayList
    $primaryFault = $null
    $runId = $null
    $startedAt = $null
    $normalizedRuntime = $null
    $layout = $null
    $rootMatrix = $null
    $project = $ProjectRoot
    $evidence = $EvidenceRoot
    $temporaryParent = $null
    $rootDefinitions = @()
    $rootMap = @{}
    $routeRoots = @{}
    $snapshotIdentity = $null
    $specs = @()
    $policyModule = $null
    $officialRoots = @()
    $projectCandidateRoots = @()
    $sourceDistPaths = @{ B = $null; C = $null }
    $guardDefinitions = @()
    $emptyManifest = [pscustomobject]@{ scope_id = "not_generated"; completed = $false; roots = @(); entries = @() }
    $emptyDiff = [pscustomobject]@{ added = @(); modified = @(); deleted = @() }
    $emptyOfficialBefore = [pscustomobject]@{ schema_version = "official-state-observation/v1"; scope_id = "official_before"; completed = $false; coverage_complete = $false; state_digest = $null; roots = @(); entries = @() }
    $emptyOfficialAfter = [pscustomobject]@{ schema_version = "official-state-observation/v1"; scope_id = "official_after"; completed = $false; coverage_complete = $false; state_digest = $null; roots = @(); entries = @() }
    $emptyProjectBefore = [pscustomobject]@{ scope_id = "project_business_candidates_before"; completed = $false; roots = @(); entries = @() }
    $emptyProjectAfter = [pscustomobject]@{ scope_id = "project_business_candidates_after"; completed = $false; roots = @(); entries = @() }
    $sourceDistReport = [pscustomobject][ordered]@{
        B = [pscustomobject]@{ path = $null; before = $emptyManifest; after = $emptyManifest; diff = $emptyDiff }
        C = [pscustomobject]@{ path = $null; before = $emptyManifest; after = $emptyManifest; diff = $emptyDiff }
    }
    $commands = New-Object System.Collections.ArrayList
    $temporaryReports = New-Object System.Collections.ArrayList
    $stagingReports = New-Object System.Collections.ArrayList
    $commandInputIdentities = @{}
    $environmentBefore = $null
    $environmentAfter = $null
    $officialBefore = $emptyOfficialBefore
    $officialAfter = $emptyOfficialAfter
    $officialDiff = $emptyDiff
    $projectCandidateBefore = $emptyProjectBefore
    $projectCandidateAfter = $emptyProjectAfter
    $projectCandidateDiff = $emptyDiff
    $stateBefore = $emptyManifest
    $stateAfter = $emptyManifest
    $sourceBefore = @{}
    $guardBefore = @{}
    $creationStages = @{}
    $officialRootsSafe = $false
    $manifestSeenReferences = New-Object System.Collections.ArrayList
    $invokeManifest = $null
    $publisherPreparation = $null
    $publisherResult = $null
    $publisherCandidate = $null
    $publisherError = $null
    $publisherAdapterThrew = $false
    $pathSecurityState = New-FoundationPathSecurityState
    $report = [pscustomobject][ordered]@{
        schema_version = "foundation-safety-report/v1"; task_id = $taskId; task_ids = @($taskId); run_id = $null
        started_at = $null; finished_at = $null; verdict = "failed"; exit_code = 1; full_case_set = "none"
        case_ids = @("CASE-STORAGE-004", "CASE-FOUNDATION-002"); requirement_ids = @("REQ-SAFE-001", "REQ-SAFE-004")
        risk_ids = @("RISK-011"); decision_ids = @("DEC-026"); debt_ids = @("DEBT-001", "DEBT-006")
        case_assertion_paths = [pscustomobject][ordered]@{ "CASE-STORAGE-004" = @(); "CASE-FOUNDATION-002" = @() }
        review_required = $true; executor = [Environment]::UserName
        roots = [pscustomobject]@{ project_root = $null; evidence_root = $null; temporary_parent = $null; official_data_roots = @(); isolated_test_root = $null; validation_root = $null; build_root = $null; openclaw_state_root = $null; root_matrix = $null }
        path_security = Get-FoundationPathSecurityReport $pathSecurityState
        runtime_identity = [pscustomobject][ordered]@{ schema_version = "runtime-identity/v1"; layout = [pscustomobject][ordered]@{ runtime_snapshot = [pscustomobject][ordered]@{ root = $null; node_root = $null; pnpm_root = $null; policy_module_path = $null; policy_module_url = $null } }; policy_bootstrap = $null; checks = @() }
        environment = [pscustomobject]@{ policy = "clean_room_exact_allowlist"; command_profiles = @(); mutation_attempted = $false; caller_unchanged = $null; restored = $null; verification_status = "pending"; before_fingerprint = $null; after_fingerprint = $null; before_names = @(); after_names = @(); before_value_hashes = @(); after_value_hashes = @() }
        commands = @(); manifests = [pscustomobject]@{ provider_dto = [pscustomobject][ordered]@{ schema_version = "manifest-provider-dto/v1"; dynamic_members_rejected = $true; nested_reference_reuse_checked = $true; provider_objects_released = $false }; official = [pscustomobject]@{ before = $emptyOfficialBefore; after = $emptyOfficialAfter; diff = $emptyDiff }; project_business_candidates = [pscustomobject]@{ before = $emptyProjectBefore; after = $emptyProjectAfter; diff = $emptyDiff }; source_dist = $sourceDistReport }
        openclaw_state = [pscustomobject]@{ pre_delete_audit = [pscustomobject]@{ completed = $false; entries = @(); business_entries = @(); internal_state_entries = @(); other_entries = @(); business_candidate_count = 0; openclaw_internal_tool_state_count = 0; other_count = 0; error_type = $null; error_text = $null }; cleanup = $null }
        external_guards = @(); temporary_roots = @(); staging = @(); errors = @(); fault = $null
        test_seams = [pscustomobject][ordered]@{ process_fault_injector_active = $false; path_phase_observer_active = [bool]($null -ne $PathPhaseObserver) }
        artifacts = @(); runtime = $null; business_impact = [pscustomobject]@{ official_added = 0; official_modified = 0; official_deleted = 0; project_candidate_added = 0; project_candidate_modified = 0; project_candidate_deleted = 0; temporary_business_candidate_count = 0; openclaw_business_candidate_count = 0 }
        report_path = $null; raw_paths = @(); raw_sha256 = @(); publisher_result = $null
    }
    try {
    $evidence = Get-FoundationFullPath $EvidenceRoot
    $report.roots.evidence_root = $evidence
    try { $runIdCandidate = & $RunIdProvider }
    catch {
        $providerError = $_.Exception.ToString()
        $runId = New-FoundationInternalFailureRunId
        $report.run_id = $runId
        throw "RUN_ID_PROVIDER_FAILED:$providerError"
    }
    if (-not (Test-FoundationRunId $runIdCandidate)) {
        $runId = New-FoundationInternalFailureRunId
        $report.run_id = $runId
        throw "RUN_ID_INVALID"
    }
    $runId = [string]$runIdCandidate
    $report.run_id = $runId
    try { $startedAt = & $Clock }
    catch { throw "CLOCK_INVALID:started_at:$($_.Exception.ToString())" }
    if (-not ($startedAt -is [datetimeoffset])) { throw "CLOCK_INVALID:started_at" }
    $report.started_at = $startedAt
    $normalizedRuntime = Assert-FoundationRuntimeContract -Runtime $Runtime -ProjectRoot $ProjectRoot
    $layout = New-FoundationRootLayout -ProjectRoot $ProjectRoot -EvidenceRoot $EvidenceRoot -Runtime $normalizedRuntime -RunId $runId
    $rootMatrix = Assert-FoundationRootMatrix -Layout $layout -Runtime $normalizedRuntime
    $project = [string]$layout.project_root
    $evidence = [string]$layout.evidence_root
    $temporaryParent = [string]$layout.temporary_parent
    $rootDefinitions = @($layout.writable_root_definitions)
    $rootMap = @{}
    foreach ($definition in $rootDefinitions) { $rootMap[$definition.root_id] = $definition.path }
    $routeRoots = @{ A = [string]$layout.route_roots.A; B = [string]$layout.route_roots.B; C = [string]$layout.route_roots.C }
    $snapshotIdentity = New-FoundationRuntimeSnapshotIdentity -Layout $layout -Runtime $normalizedRuntime
    $specs = @()
    $policyModule = $null
    $officialRoots = @(
        [pscustomobject]@{ route = "A"; path = Join-Path $project "version-a-skill-only\data"; source = "fixed_project_layout" },
        [pscustomobject]@{ route = "B"; path = Join-Path $project "version-b-lite-plugin\data"; source = "fixed_project_layout" },
        [pscustomobject]@{ route = "C"; path = Join-Path $project "version-c-strict-plugin\data"; source = "fixed_project_layout" }
    )
    $projectCandidateRoots = @(
        [pscustomobject]@{ root_id = "project_root"; path = $project },
        [pscustomobject]@{ root_id = "route_A"; path = Join-Path $project "version-a-skill-only" },
        [pscustomobject]@{ root_id = "route_B"; path = Join-Path $project "version-b-lite-plugin" },
        [pscustomobject]@{ root_id = "route_C"; path = Join-Path $project "version-c-strict-plugin" }
    )
    $sourceDistPaths = @{
        B = Join-Path $project "version-b-lite-plugin\dist"
        C = Join-Path $project "version-c-strict-plugin\dist"
    }
    $sourceDistReport = [pscustomobject][ordered]@{
        B = [pscustomobject]@{ path = $sourceDistPaths.B; before = [pscustomobject]@{ scope_id = "source_dist_B_before"; completed = $false; roots = @(); entries = @() }; after = [pscustomobject]@{ scope_id = "source_dist_B_after"; completed = $false; roots = @(); entries = @() }; diff = [pscustomobject]@{ added = @(); modified = @(); deleted = @() } }
        C = [pscustomobject]@{ path = $sourceDistPaths.C; before = [pscustomobject]@{ scope_id = "source_dist_C_before"; completed = $false; roots = @(); entries = @() }; after = [pscustomobject]@{ scope_id = "source_dist_C_after"; completed = $false; roots = @(); entries = @() }; diff = [pscustomobject]@{ added = @(); modified = @(); deleted = @() } }
    }
    $guardDefinitions = @(
        [pscustomobject]@{ guard_id = "jiti_openclaw_cache_guard"; path = [string]$normalizedRuntime.protected_external_paths.jiti_openclaw_cache_guard },
        [pscustomobject]@{ guard_id = "node_compile_cache_guard"; path = [string]$normalizedRuntime.protected_external_paths.node_compile_cache_guard },
        [pscustomobject]@{ guard_id = "inherited_openclaw_temp_guard"; path = [string]$normalizedRuntime.protected_external_paths.inherited_openclaw_temp_guard },
        [pscustomobject]@{ guard_id = "vitest_b_cache_guard"; path = [string]$normalizedRuntime.protected_external_paths.vitest_b_cache_guard },
        [pscustomobject]@{ guard_id = "vitest_c_cache_guard"; path = [string]$normalizedRuntime.protected_external_paths.vitest_c_cache_guard }
    )
    $emptyManifest = [pscustomobject]@{ scope_id = "not_generated"; roots = @(); entries = @() }
    $emptyDiff = [pscustomobject]@{ added = @(); modified = @(); deleted = @() }
    $emptyOfficialBefore = [pscustomobject]@{ schema_version = "official-state-observation/v1"; scope_id = "official_before"; completed = $false; coverage_complete = $false; state_digest = $null; roots = @(); entries = @() }
    $emptyOfficialAfter = [pscustomobject]@{ schema_version = "official-state-observation/v1"; scope_id = "official_after"; completed = $false; coverage_complete = $false; state_digest = $null; roots = @(); entries = @() }
    $emptyProjectBefore = [pscustomobject]@{ scope_id = "project_business_candidates_before"; completed = $false; roots = @(); entries = @() }
    $emptyProjectAfter = [pscustomobject]@{ scope_id = "project_business_candidates_after"; completed = $false; roots = @(); entries = @() }
    $commands = New-Object System.Collections.ArrayList
    foreach ($spec in $specs) { [void]$commands.Add((New-FoundationCommandObject $spec)) }
    $temporaryReports = New-Object System.Collections.ArrayList
    foreach ($definition in $rootDefinitions) {
        [void]$temporaryReports.Add([pscustomobject]@{ root_id = $definition.root_id; path = $definition.path; trusted_parent = $definition.trusted_parent; path_identity = $null; pre_delete_audit = $null; cleanup = $null; physical_residual_entries = @(); physical_residual_count = $null })
    }
    $report = [pscustomobject][ordered]@{
        schema_version = "foundation-safety-report/v1"; task_id = $taskId; task_ids = @($taskId); run_id = $runId
        started_at = $startedAt; finished_at = $null; verdict = "failed"; exit_code = 1; full_case_set = "none"
        case_ids = @("CASE-STORAGE-004", "CASE-FOUNDATION-002"); requirement_ids = @("REQ-SAFE-001", "REQ-SAFE-004")
        risk_ids = @("RISK-011"); decision_ids = @("DEC-026"); debt_ids = @("DEBT-001", "DEBT-006")
        case_assertion_paths = [pscustomobject][ordered]@{
            "CASE-STORAGE-004" = @(
                "/oracle/path_safety/official_roots_source",
                "/oracle/path_safety/traversal_rejected",
                "/oracle/path_safety/absolute_external_path_rejected",
                "/oracle/path_safety/prefix_collision_rejected",
                "/oracle/path_safety/reparse_point_escape_rejected",
                "/oracle/path_safety/out_of_root_write_count"
            )
            "CASE-FOUNDATION-002" = @(
                "/oracle/official_manifest/diff/added",
                "/oracle/official_manifest/diff/modified",
                "/oracle/official_manifest/diff/deleted",
                "/oracle/project_business_candidates/diff/added",
                "/oracle/project_business_candidates/diff/modified",
                "/oracle/project_business_candidates/diff/deleted",
                "/oracle/failure_path/after_manifest_generated",
                "/oracle/environment/restored",
                "/oracle/openclaw_state/pre_delete_audit",
                "/oracle/temporary_roots/residual_count",
                "/oracle/source_dist/diff"
            )
        }
        review_required = $true; executor = [Environment]::UserName
        roots = [pscustomobject]@{ project_root = $project; evidence_root = $evidence; temporary_parent = $temporaryParent; official_data_roots = @($officialRoots); isolated_test_root = $rootMap.isolated_test_root; validation_root = $rootMap.validation_root; build_root = $rootMap.build_root; openclaw_state_root = $rootMap.openclaw_state_root; root_matrix = $rootMatrix }
        path_security = Get-FoundationPathSecurityReport $pathSecurityState
        runtime_identity = [pscustomobject][ordered]@{
            schema_version = "runtime-identity/v1"
            layout = [pscustomobject][ordered]@{
                runtime_snapshot = [pscustomobject][ordered]@{
                    root = [string]$snapshotIdentity.root
                    node_root = [string]$snapshotIdentity.node_root
                    pnpm_root = [string]$snapshotIdentity.pnpm_root
                    policy_module_path = [string]$snapshotIdentity.policy_module_path
                    policy_module_url = [string]$snapshotIdentity.policy_module_url
                }
            }
            policy_bootstrap = $null
            checks = @()
        }
        environment = [pscustomobject]@{ policy = "clean_room_exact_allowlist"; command_profiles = @(); mutation_attempted = $false; caller_unchanged = $null; restored = $null; verification_status = "pending"; before_fingerprint = $null; after_fingerprint = $null; before_names = @(); after_names = @(); before_value_hashes = @(); after_value_hashes = @() }
        commands = @($commands); manifests = [pscustomobject]@{ provider_dto = [pscustomobject][ordered]@{ schema_version = "manifest-provider-dto/v1"; dynamic_members_rejected = $true; nested_reference_reuse_checked = $true; provider_objects_released = $false }; official = [pscustomobject]@{ before = $emptyOfficialBefore; after = $emptyOfficialAfter; diff = $emptyDiff }; project_business_candidates = [pscustomobject]@{ before = $emptyProjectBefore; after = $emptyProjectAfter; diff = [pscustomobject]@{ added = @(); modified = @(); deleted = @() } }; source_dist = $sourceDistReport }
        openclaw_state = [pscustomobject]@{ pre_delete_audit = [pscustomobject]@{ completed = $false; entries = @(); business_entries = @(); internal_state_entries = @(); other_entries = @(); business_candidate_count = 0; openclaw_internal_tool_state_count = 0; other_count = 0; error_type = $null; error_text = $null }; cleanup = $null }
        external_guards = @(); temporary_roots = @($temporaryReports); staging = @(); errors = @(); fault = $null
        test_seams = [pscustomobject][ordered]@{ process_fault_injector_active = $false; path_phase_observer_active = [bool]($null -ne $PathPhaseObserver) }
        artifacts = @(); runtime = $normalizedRuntime; business_impact = [pscustomobject]@{ official_added = 0; official_modified = 0; official_deleted = 0; project_candidate_added = 0; project_candidate_modified = 0; project_candidate_deleted = 0; temporary_business_candidate_count = 0; openclaw_business_candidate_count = 0 }
        report_path = $null; raw_paths = @(); raw_sha256 = @(); publisher_result = $null
    }
    $environmentBefore = $null
    $environmentAfter = $null
    $officialBefore = $emptyOfficialBefore
    $officialAfter = $emptyOfficialAfter
    $projectCandidateBefore = $emptyProjectBefore
    $projectCandidateAfter = $emptyProjectAfter
    $stateBefore = $emptyManifest
    $stateAfter = $emptyManifest
    $sourceBefore = @{}
    $guardBefore = @{}
    $creationStages = @{}
    $officialRootsSafe = $true
    $stagingReports = New-Object System.Collections.ArrayList
    $commandInputIdentities = @{}
    $manifestSeenReferences = New-Object System.Collections.ArrayList

    $invokeManifest = {
        param($Request, [string[]]$PrivateExcludedSubtrees = @())
        if ($null -eq $Request -or [string]::IsNullOrWhiteSpace([string]$Request.scope_id)) {
            throw "MANIFEST_RESULT_IDENTITY_INVALID:request"
        }
        $requestRoots = @($Request.roots)
        $expectedRoots = New-Object System.Collections.ArrayList
        foreach ($requestRoot in $requestRoots) {
            $expectedPath = Get-FoundationFullPath ([string]$requestRoot.path)
            $existsBefore = [bool](Test-Path -LiteralPath $expectedPath)
            [void]$expectedRoots.Add([pscustomobject]@{ root_id = [string]$requestRoot.root_id; path = $expectedPath; exists_before = $existsBefore })
        }
        if ($null -ne $ManifestProvider) {
            if (@($PrivateExcludedSubtrees).Count -ne 0) { throw "MANIFEST_PROVIDER_PRIVATE_EXCLUSION_UNSUPPORTED" }
            $manifestResult = & $ManifestProvider $Request
        }
        else { $manifestResult = Invoke-FoundationDefaultManifestProvider $Request -ExcludedSubtrees $PrivateExcludedSubtrees }
        $manifestDto = Copy-FoundationManifestProviderResult -Value $manifestResult -SeenReferences $manifestSeenReferences
        if ([string]$manifestDto.scope_id -cne [string]$Request.scope_id) {
            throw "MANIFEST_RESULT_IDENTITY_INVALID:scope_id"
        }
        $resultRoots = @($manifestDto.roots)
        if ($resultRoots.Count -ne $expectedRoots.Count) {
            throw "MANIFEST_RESULT_IDENTITY_INVALID:root_count"
        }
        for ($rootIndex = 0; $rootIndex -lt $expectedRoots.Count; $rootIndex++) {
            $expectedRoot = $expectedRoots[$rootIndex]
            $actualRoot = $resultRoots[$rootIndex]
            if ($null -eq $actualRoot -or [string]$actualRoot.root_id -cne [string]$expectedRoot.root_id) {
                throw "MANIFEST_RESULT_IDENTITY_INVALID:root_id"
            }
            $actualPath = Get-FoundationFullPath ([string]$actualRoot.path)
            if (-not $actualPath.Equals([string]$expectedRoot.path, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "MANIFEST_RESULT_IDENTITY_INVALID:root_path"
            }
            $existsAfter = [bool](Test-Path -LiteralPath ([string]$expectedRoot.path))
            if ($null -eq $actualRoot.PSObject.Properties["exists"] -or -not ($actualRoot.exists -is [bool]) -or
                [bool]$actualRoot.exists -ne [bool]$expectedRoot.exists_before -or [bool]$actualRoot.exists -ne $existsAfter) {
                throw "MANIFEST_RESULT_IDENTITY_INVALID:root_exists"
            }
        }
        [void](Add-FoundationPathSnapshotOperation -State $pathSecurityState -OperationId ("manifest_read:" + [string]$Request.scope_id) -OperationKind "manifest_read" -Paths @($expectedRoots | ForEach-Object { [string]$_.path }) -ShareWrite $false -AllowMissing $true)
        return $manifestDto
    }
        try { $environmentBefore = Copy-FoundationEnvironmentSnapshot (& $EnvironmentAdapter ([pscustomobject]@{ operation = "snapshot"; scope = "process" })) }
        catch { $environmentBefore = [pscustomobject]@{ success = $false; entries = @(); error_type = $_.Exception.GetType().FullName; error_text = $_.Exception.ToString() } }
        if ($null -eq $environmentBefore -or -not [bool]$environmentBefore.success) {
            [void]$errors.Add([pscustomobject]@{ code = "environment_snapshot_failed"; category = "environment"; message = [string]$environmentBefore.error_text })
            $primaryFault = [pscustomobject]@{ injection = "before_environment_snapshot_failure"; code = "environment_snapshot_failed" }
        }

        foreach ($entry in $officialRoots) {
            $relative = Get-FoundationRelativePath $project $entry.path
            $resolved = Resolve-FoundationChildPath -TrustedParent $project -CandidateRelativePath $relative -ExpectedLeaf "data"
            if (-not $resolved.allowed) {
                $officialRootsSafe = $false
                [void]$errors.Add([pscustomobject]@{ code = [string]$resolved.error_code; category = "path"; message = [string]$resolved.error_text; path = [string]$entry.path })
                if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "official_data_reparse_root"; code = [string]$resolved.error_code } }
            }
        }

        $officialBeforeErrorCount = $errors.Count
        $officialBefore = Invoke-FoundationOfficialStateObservation -ScopeId "official_before" -ProjectRoot $project -OfficialRoots $officialRoots -ManifestInvoker $invokeManifest -ErrorSink $errors
        if (-not [bool]$officialBefore.completed -or -not [bool]$officialBefore.coverage_complete) {
            $officialRootsSafe = $false
            [void]$errors.Add([pscustomobject]@{ code = "OFFICIAL_BASELINE_UNAVAILABLE"; category = "manifest"; message = "Official before observation is not a complete baseline"; scope_id = "official_before" })
        }
        if ($errors.Count -gt $officialBeforeErrorCount -and $null -eq $primaryFault) {
            $newOfficialErrors = @($errors | Select-Object -Skip $officialBeforeErrorCount)
            $officialCode = [string]$newOfficialErrors[0].code
            $officialInjection = "official_observation_failure"
            if ($officialCode -eq "manifest_failed") { $officialInjection = "manifest_provider_scope_throw" }
            $primaryFault = [pscustomobject]@{ injection = $officialInjection; code = $officialCode }
        }
        $report.manifests.official.before = $officialBefore

        $projectBeforeErrorCount = $errors.Count
        $projectCandidateBefore = Invoke-FoundationProjectCandidateObservation -ScopeId "project_business_candidates_before" -ProjectRoot $project -ProjectRoots $projectCandidateRoots -ManifestInvoker $invokeManifest -ErrorSink $errors
        $report.manifests.project_business_candidates.before = $projectCandidateBefore
        if (-not [bool]$projectCandidateBefore.completed) {
            if ($errors.Count -eq $projectBeforeErrorCount) {
                [void]$errors.Add([pscustomobject]@{ code = "PROJECT_BUSINESS_CANDIDATE_OBSERVATION_INCOMPLETE"; category = "manifest"; message = "Project business candidate before observation is incomplete"; scope_id = "project_business_candidates_before" })
            }
            if ($null -eq $primaryFault) {
                $newProjectErrors = @($errors | Select-Object -Skip $projectBeforeErrorCount)
                $projectCode = [string]$newProjectErrors[0].code
                $projectInjection = "project_business_candidate_observation"
                if ($projectCode -eq "manifest_failed") { $projectInjection = "manifest_provider_scope_throw" }
                $primaryFault = [pscustomobject]@{ injection = $projectInjection; code = $projectCode }
            }
        }

        foreach ($route in @("B", "C")) {
            $path = [string]$sourceDistPaths[$route]
            $scopeId = "source_dist_${route}_before"
            try {
                $sourceRaw = Set-FoundationSourceDistEntryClassification (& $invokeManifest ([pscustomobject]@{ scope_id = $scopeId; roots = @([pscustomobject]@{ root_id = "source_dist_$route"; path = $path }); exclude_node_modules = $false; include_dist = $true; all_files = $true }))
                $sourceBefore[$route] = Copy-FoundationManifestObservation $sourceRaw $true
            }
            catch {
                $sourceBefore[$route] = [pscustomobject]@{ scope_id = $scopeId; completed = $false; roots = @([pscustomobject]@{ root_id = "source_dist_$route"; path = $path; exists = [bool](Test-Path -LiteralPath $path) }); entries = @() }
                [void]$errors.Add([pscustomobject]@{ code = "manifest_failed"; category = "manifest"; message = $_.Exception.ToString(); scope_id = $scopeId })
                if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "manifest_provider_scope_throw"; code = "manifest_failed" } }
            }
            $sourceDistReport.PSObject.Properties[$route].Value.before = $sourceBefore[$route]
        }
        foreach ($guard in $guardDefinitions) {
            try { $guardBefore[$guard.guard_id] = & $invokeManifest ([pscustomobject]@{ scope_id = ("guard_" + $guard.guard_id + "_before"); roots = @([pscustomobject]@{ root_id = $guard.guard_id; path = $guard.path }); exclude_node_modules = $false; include_dist = $true; all_files = $true }) }
            catch {
                $guardBefore[$guard.guard_id] = $emptyManifest
                [void]$errors.Add([pscustomobject]@{ code = "manifest_failed"; category = "manifest"; message = $_.Exception.ToString(); scope_id = ("guard_" + $guard.guard_id + "_before") })
                if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "manifest_provider_scope_throw"; code = "manifest_failed" } }
            }
        }

        foreach ($definition in $rootDefinitions) {
            $parent = Get-FoundationFullPath $definition.trusted_parent
            $resolved = Resolve-FoundationChildPath -TrustedParent $parent -CandidateRelativePath (Join-Path $taskId $runId) -ExpectedLeaf $runId
            if (-not $resolved.allowed) { throw ([string]$resolved.error_code) }
            $createdRootPins = New-FoundationPinnedDirectory -Path ([string]$definition.path) -PathPhaseObserver $PathPhaseObserver -OperationId ("root_create:" + [string]$definition.root_id) -PathSecurityState $pathSecurityState -OperationKind "root_create"
            try {
                $rootPin = @($createdRootPins.pins | Where-Object { [string]$_.path -ceq [string]$definition.path })[-1]
                if ($null -eq $rootPin) { throw "PATH_IDENTITY_CHANGED:$($definition.path)" }
                $definition | Add-Member -NotePropertyName path_identity -NotePropertyValue ([pscustomobject][ordered]@{ volume_serial = [string]$rootPin.volume_serial; file_id = [string]$rootPin.file_id }) -Force
                $rootReport = @($temporaryReports | Where-Object { [string]$_.root_id -ceq [string]$definition.root_id })[0]
                $rootReport.path_identity = $definition.path_identity
            }
            finally {
                Close-FoundationPinSet $createdRootPins
            }
        }
        $sourceStartHandles = New-Object System.Collections.ArrayList
        try {
        $sourceStartCheck = New-FoundationRuntimeIdentityCheck -Runtime $normalizedRuntime -SnapshotIdentity $snapshotIdentity -Phase "source_start" -IncludeSnapshot $false -RetainedHandles $sourceStartHandles -RetainRuntimeInputs $true -PathSecurityState $pathSecurityState -PathOperationPrefix "runtime_read:source_start"
            $report.runtime_identity.checks = @($report.runtime_identity.checks) + @($sourceStartCheck)
        }
        finally {
            Close-FoundationHandleCollection $sourceStartHandles
        }
        $identityExpectations = $normalizedRuntime.identity_expectations
        $nativeAllowlist = Get-FoundationObjectValue $identityExpectations "native_execution_allowlist"
        $toolExpectations = Get-FoundationObjectValue $identityExpectations "tools"
        $snapshotNodeExpectation = Get-FoundationObjectValue $nativeAllowlist "snapshot_node_executable"
        $sourceNodePath = ConvertTo-FoundationStrictLocalPath ([string]$normalizedRuntime.node_path)
        $sourceNodePins = New-FoundationPinnedPathChain -Path $sourceNodePath -ShareWrite $false -AllowMissing $false
        $sourceNodeHandle = $null
        try {
            $sourceNodeHandle = [FoundationValidationNativePath]::OpenImmutableRead($sourceNodePath)
            $sourceNodeInfo = [FoundationValidationNativePath]::GetInfo($sourceNodeHandle)
            $sourceNodeExpectedHash = [string](Get-FoundationObjectValue $snapshotNodeExpectation "sha256")
            if (($sourceNodeInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_REPARSE_POINT) -ne 0 -or
                ($sourceNodeInfo.Attributes -band [FoundationValidationNativePath]::FILE_ATTRIBUTE_DIRECTORY) -ne 0 -or
                [string]::IsNullOrWhiteSpace($sourceNodeExpectedHash) -or
                [FoundationValidationNativePath]::Sha256($sourceNodeHandle) -cne $sourceNodeExpectedHash.ToUpperInvariant()) {
                throw "RUNTIME_IDENTITY_INVALID:node_path"
            }
        }
        finally {
            if ($null -ne $sourceNodeHandle) { $sourceNodeHandle.Dispose() }
            Close-FoundationPinSet $sourceNodePins
        }
        $toolSources = @(
            (Assert-FoundationConfiguredToolSource -Runtime $normalizedRuntime -Name "vitest" -RuntimePathProperty "vitest_path"),
            (Assert-FoundationConfiguredToolSource -Runtime $normalizedRuntime -Name "typescript" -RuntimePathProperty "typescript_path"),
            (Assert-FoundationConfiguredToolSource -Runtime $normalizedRuntime -Name "openclaw" -RuntimePathProperty "openclaw_path")
        )

        $runtimeSnapshot = New-FoundationRuntimeSnapshot -Layout $layout -Runtime $normalizedRuntime -SnapshotIdentity $snapshotIdentity -PathSecurityState $pathSecurityState
        $report.runtime_identity.layout.runtime_snapshot | Add-Member -NotePropertyName verified -NotePropertyValue $true
        $report.runtime_identity.layout.runtime_snapshot | Add-Member -NotePropertyName source_trees -NotePropertyValue $runtimeSnapshot.source
        $report.runtime_identity.layout.runtime_snapshot | Add-Member -NotePropertyName snapshot_trees -NotePropertyValue $runtimeSnapshot.snapshot
        $report.runtime_identity.layout.runtime_snapshot | Add-Member -NotePropertyName tool_sources -NotePropertyValue @($toolSources)
        $policyModule = New-FoundationPolicyModule -Layout $layout -PathPhaseObserver $PathPhaseObserver -PathSecurityState $pathSecurityState
        $report.runtime_identity.policy_bootstrap = New-FoundationPolicyBootstrapReport -PolicyModule $policyModule
        $snapshotReadyHandles = New-Object System.Collections.ArrayList
        try {
            $snapshotReadyCheck = New-FoundationRuntimeIdentityCheck -Runtime $normalizedRuntime -SnapshotIdentity $snapshotIdentity -Phase "snapshot_ready" -IncludeSnapshot $true -PolicyModule $policyModule -RetainedHandles $snapshotReadyHandles -RetainRuntimeInputs $true -PathSecurityState $pathSecurityState -PathOperationPrefix "runtime_read:snapshot_ready"
            $report.runtime_identity.checks = @($report.runtime_identity.checks) + @($snapshotReadyCheck)
        }
        finally {
            Close-FoundationHandleCollection $snapshotReadyHandles
        }
        $specs = @(New-FoundationCommandSpecifications -Layout $layout -Runtime $normalizedRuntime -SnapshotIdentity $snapshotIdentity)
        foreach ($spec in $specs) { [void]$commands.Add((New-FoundationCommandObject $spec)) }
        $report.commands = @($commands)

        $report.runtime_identity.policy_bootstrap.derived_node_prefixes = @($specs | Where-Object { $null -ne $_.node_runtime } | ForEach-Object {
            [pscustomobject][ordered]@{ command_id = [string]$_.id; argument_vector = @($_.node_runtime.derived_node_prefix) }
        })
        foreach ($spec in $specs) { Initialize-FoundationCommandProfileDirectories -Spec $spec }

        if ($errors.Count -eq 0) {
            $staged = @{}
            $stagingPathOperationIds = @{}
            for ($index = 0; $index -lt $specs.Count; $index++) {
                $spec = $specs[$index]
                $commandLifecycleHandles = New-Object System.Collections.ArrayList
                $commandLaunchPinBundle = $null
                try {
                if ($null -ne $spec.node_runtime -and -not $staged.ContainsKey([string]$spec.route)) {
                    try {
                        $staging = New-FoundationPluginStaging -Route ([string]$spec.route) -RouteRoot ([string]$routeRoots[[string]$spec.route]) -StagingRoot ([string]$spec.cwd) -Runtime $normalizedRuntime -PathPhaseObserver $PathPhaseObserver -PathSecurityState $pathSecurityState
                        [void]$stagingReports.Add($staging)
                        $staged[[string]$spec.route] = $true
                        $stagingPathOperationIds[[string]$spec.route] = @($staging.path_operation_ids)
                    }
                    catch {
                        [void]$errors.Add([pscustomobject]@{ code = "STAGING_DEPENDENCY_INVALID"; category = "staging"; message = $_.Exception.ToString(); route = [string]$spec.route })
                        if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "invalid_typebox_dependency"; code = "STAGING_DEPENDENCY_INVALID" } }
                        break
                    }
                }
                try {
                    if ([string]$spec.stage -like "plugin_*") {
                        $pluginDist = Join-FoundationValidatedChildPath -Parent (ConvertTo-FoundationStrictLocalPath ([string]$spec.staging_root)) -Name "dist"
                        Assert-FoundationOrdinaryDirectoryPath -Path $pluginDist -Label ("$($spec.id)_dist")
                    }
                    $beforePrefix = "runtime_read:before_command:" + [string]$spec.id
                    $beforeCommandCheck = New-FoundationRuntimeIdentityCheck -Runtime $normalizedRuntime -SnapshotIdentity $snapshotIdentity -Phase "before_command" -IncludeSnapshot $true -CommandId ([string]$spec.id) -PolicyModule $policyModule -RetainedHandles $commandLifecycleHandles -RetainRuntimeInputs $true -CommandSpec $spec -RetainCommandInputs $true -PathSecurityState $pathSecurityState -PathOperationPrefix $beforePrefix
                    $beforeInputRows = @($beforeCommandCheck.command_input_identities | Where-Object { [string]$_.command_id -ceq [string]$spec.id })
                    if ($beforeInputRows.Count -ne 1) { throw "RUNTIME_IDENTITY_INVALID:$($spec.id):command_input_capture" }
                    $commandInputIdentities[[string]$spec.id] = $beforeInputRows[0].identity
                    $report.runtime_identity.checks = @($report.runtime_identity.checks) + @($beforeCommandCheck)
                    $pathOperationIds = New-Object System.Collections.ArrayList
                    if ($stagingPathOperationIds.ContainsKey([string]$spec.route)) {
                        foreach ($pathOperationId in @($stagingPathOperationIds[[string]$spec.route])) { [void]$pathOperationIds.Add([string]$pathOperationId) }
                    }
                    foreach ($pathOperation in @($pathSecurityState.operations | Where-Object { ([string]$_.operation_id).StartsWith(($beforePrefix + ":"), [System.StringComparison]::Ordinal) })) {
                        [void]$pathOperationIds.Add([string]$pathOperation.operation_id)
                    }
                    $commandLaunchPinBundle = New-FoundationCommandLaunchPinBundle -Spec $spec
                    $launchPinOperationId = "command_launch:" + [string]$spec.id + ":pin"
                    try {
                        Invoke-FoundationPathPhaseObserver -Observer $PathPhaseObserver -Phase "runtime_snapshot_after_input_pin_before_launch" -OperationId $launchPinOperationId -PinnedPaths @($commandLaunchPinBundle.pins) -TargetPath ([string]$spec.executable)
                        [void](Add-FoundationPathSecurityOperation -State $pathSecurityState -OperationId $launchPinOperationId -OperationKind "command_launch" -Phase "pin" -PinnedPaths @($commandLaunchPinBundle.pins) -ImmutableInputCount ([int]$commandLaunchPinBundle.immutable_input_count) -Succeeded $true)
                    }
                    catch {
                        if (-not $pathSecurityState.operation_ids.Contains($launchPinOperationId)) {
                            [void](Add-FoundationPathSecurityOperation -State $pathSecurityState -OperationId $launchPinOperationId -OperationKind "command_launch" -Phase "pin" -PinnedPaths @($commandLaunchPinBundle.pins) -ImmutableInputCount ([int]$commandLaunchPinBundle.immutable_input_count) -Succeeded $false -ErrorCode (Get-FoundationPathOperationErrorCode $_.Exception.ToString()))
                        }
                        throw
                    }
                    [void]$pathOperationIds.Add($launchPinOperationId)
                    $currentPathOperationIds = @($pathOperationIds)
                }
                catch {
                    $beforeCode = if ($_.Exception.Message -match '(PATH_[A-Z_]+)') { [string]$Matches[1] } else { "RUNTIME_IDENTITY_INVALID" }
                    $report.runtime_identity.checks = @($report.runtime_identity.checks) + @([pscustomobject][ordered]@{ phase = "before_command"; command_id = [string]$spec.id; matched = $false; error_code = $beforeCode; source_tree_sha256 = $null; snapshot_tree_sha256 = $null; snapshot_check_applicable = $true; pinned_input_count = Get-FoundationLivePinnedInputCount -Handles $commandLifecycleHandles -PolicyModule $policyModule })
                    [void]$errors.Add([pscustomobject]@{ code = $beforeCode; category = if ($beforeCode -like 'PATH_*') { "path" } else { "runtime" }; command_id = [string]$spec.id; message = $_.Exception.ToString() })
                    if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = ("before_command:" + [string]$spec.id); code = $beforeCode } }
                    break
                }
                try { $result = & $CommandRunner $spec }
                catch { $result = [pscustomobject]@{ started_at = $null; finished_at = $null; status = "failed"; exit_code = $null; stdout = ""; stderr = ""; environment_key_names = @(); environment_value_sources = @(); exception_type = $_.Exception.GetType().FullName; exception_text = $_.Exception.ToString(); timeout_ms = 120000; timed_out = $false } }
                $launchCompleteOperationId = "command_launch:" + [string]$spec.id + ":complete"
                [void](Add-FoundationPathSecurityOperation -State $pathSecurityState -OperationId $launchCompleteOperationId -OperationKind "command_launch" -Phase "complete" -PinnedPaths @($commandLaunchPinBundle.pins) -ImmutableInputCount ([int]$commandLaunchPinBundle.immutable_input_count) -Succeeded $true)
                $currentPathOperationIds = @($currentPathOperationIds) + @($launchCompleteOperationId)
                if ($null -ne $spec.node_runtime) {
                    try {
                        $nativeEvidencePending = $null -ne $result.PSObject.Properties["foundation_native_evidence_pending"] -and [bool]$result.foundation_native_evidence_pending
                        $physicalPolicyEvidence = Read-FoundationPhysicalPolicyJournal -Spec $spec -RunnerResult $(if ($nativeEvidencePending) { $null } else { $result })
                        if ($nativeEvidencePending) {
                            $result = Complete-FoundationNativePolicyJobEvidence -Spec $spec -Result $result -Evidence $physicalPolicyEvidence
                        }
                        else {
                            $result = Set-FoundationPhysicalPolicyEvidence -Result $result -Evidence $physicalPolicyEvidence
                        }
                    }
                    catch {
                        $journalCode = "TRUSTED_POLICY_ATTESTATION_INVALID"
                        if ($_.Exception.Message -match 'PATH_REPARSE_POINT_REJECTED') { $journalCode = "PATH_REPARSE_POINT_REJECTED" }
                        elseif ($_.Exception.Message -match '(PROCESS_[A-Z_]+)') { $journalCode = [string]$Matches[1] }
                        elseif ($_.Exception.Message -match '(TRUSTED_POLICY_[A-Z_]+_INVALID)') { $journalCode = [string]$Matches[1] }
                        foreach ($property in @(
                            [pscustomobject]@{ name = "status"; value = "failed" },
                            [pscustomobject]@{ name = "exit_code"; value = $null },
                            [pscustomobject]@{ name = "error_code"; value = $journalCode },
                            [pscustomobject]@{ name = "exception_type"; value = $_.Exception.GetType().FullName },
                            [pscustomobject]@{ name = "exception_text"; value = $_.Exception.ToString() }
                        )) {
                            if ($null -eq $result.PSObject.Properties[$property.name]) { $result | Add-Member -NotePropertyName $property.name -NotePropertyValue $property.value }
                            else { $result.PSObject.Properties[$property.name].Value = $property.value }
                        }
                    }
                }
                $command = Merge-FoundationCommandResult $spec $result
                $command.path_operation_ids = @($currentPathOperationIds)
                $commands[$index] = $command
                $report.commands = @($commands)
                try {
                    $afterPrefix = "runtime_read:after_command:" + [string]$spec.id
                    $afterCommandCheck = New-FoundationRuntimeIdentityCheck -Runtime $normalizedRuntime -SnapshotIdentity $snapshotIdentity -Phase "after_command" -IncludeSnapshot $true -CommandId ([string]$spec.id) -PolicyModule $policyModule -RetainedHandles $commandLifecycleHandles -RetainRuntimeInputs $false -CommandSpec $spec -ExpectedCommandInputIdentity $commandInputIdentities[[string]$spec.id] -RetainCommandInputs $true -AllowBuildOutput ([string]$spec.stage -ceq "build") -Commands @($command) -Specs @($spec) -RequireExecutionQuiescence $true -PathSecurityState $pathSecurityState -PathOperationPrefix $afterPrefix
                    $afterInputRows = @($afterCommandCheck.command_input_identities | Where-Object { [string]$_.command_id -ceq [string]$spec.id })
                    if ($afterInputRows.Count -ne 1) { throw "RUNTIME_IDENTITY_INVALID:$($spec.id):command_input_capture" }
                    $commandInputIdentities[[string]$spec.id] = $afterInputRows[0].identity
                    $report.runtime_identity.checks = @($report.runtime_identity.checks) + @($afterCommandCheck)
                    foreach ($pathOperation in @($pathSecurityState.operations | Where-Object { ([string]$_.operation_id).StartsWith(($afterPrefix + ":"), [System.StringComparison]::Ordinal) })) {
                        $currentPathOperationIds = @($currentPathOperationIds) + @([string]$pathOperation.operation_id)
                    }
                    $command.path_operation_ids = @($currentPathOperationIds)
                    $commands[$index] = $command
                    $report.commands = @($commands)
                }
                catch {
                    $afterCode = if ($_.Exception.Message -match '(PROCESS_[A-Z_]+)') { [string]$Matches[1] } elseif ($_.Exception.Message -match '(TRUSTED_POLICY_[A-Z_]+_INVALID)') { [string]$Matches[1] } else { "RUNTIME_IDENTITY_INVALID" }
                    $report.runtime_identity.checks = @($report.runtime_identity.checks) + @([pscustomobject][ordered]@{ phase = "after_command"; command_id = [string]$spec.id; matched = $false; error_code = $afterCode; source_tree_sha256 = $null; snapshot_tree_sha256 = $null; snapshot_check_applicable = $true; pinned_input_count = Get-FoundationLivePinnedInputCount -Handles $commandLifecycleHandles -PolicyModule $policyModule })
                    $command.status = "failed"
                    $command.exit_code = $null
                    $command.error_code = $afterCode
                    $command.exception_type = $_.Exception.GetType().FullName
                    $command.exception_text = $_.Exception.ToString()
                    $commands[$index] = $command
                    $report.commands = @($commands)
                }
                if ($spec.stage -like "plugin*") {
                    try {
                        $files = @(Get-FoundationSafeFiles -Root $rootMap.openclaw_state_root -ExcludeNodeModules $false -IncludeDist $true)
                        foreach ($file in $files) { if (-not $creationStages.ContainsKey($file.FullName)) { $creationStages[$file.FullName] = [string]$spec.id } }
                    }
                    catch { }
                }
                if ($null -eq $command.exit_code -or [int]$command.exit_code -ne 0 -or [string]$command.status -eq "failed") {
                    $code = [string]$command.error_code
                    if ([string]::IsNullOrWhiteSpace($code)) { $code = if ($null -eq $command.exit_code) { "COMMAND_EXECUTION_FAILED" } else { [string]$command.exit_code } }
                    [void]$errors.Add([pscustomobject]@{ code = $code; category = "command"; command_id = [string]$spec.id; message = ([string]$command.stderr + " " + [string]$command.exception_text).Trim() })
                    foreach ($terminationError in @($command.termination_errors)) {
                        [void]$errors.Add([pscustomobject][ordered]@{
                            code = [string]$terminationError.error_code
                            category = "termination"
                            command_id = [string]$spec.id
                            error_type = [string]$terminationError.error_type
                            message = [string]$terminationError.error_text
                        })
                    }
                    if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = [string]$spec.id; code = $code } }
                    break
                }
                }
                finally {
                    Close-FoundationCommandLaunchPinBundle $commandLaunchPinBundle
                    Close-FoundationHandleCollection $commandLifecycleHandles
                }
            }
        }
    }
    catch {
        $lifecycleCode = "foundation_validation_failed"
        if ($_.Exception.Message -match 'RUN_ID_PROVIDER_FAILED') { $lifecycleCode = "RUN_ID_PROVIDER_FAILED" }
        elseif ($_.Exception.Message -match 'RUN_ID_INVALID') { $lifecycleCode = "RUN_ID_INVALID" }
        elseif ($_.Exception.Message -match 'CLOCK_INVALID') { $lifecycleCode = "CLOCK_INVALID" }
        elseif ($_.Exception.Message -match 'PATH_REPARSE_POINT_REJECTED') { $lifecycleCode = "PATH_REPARSE_POINT_REJECTED" }
        elseif ($_.Exception.Message -match 'PATH_OUTSIDE_ALLOWED_ROOT') { $lifecycleCode = "PATH_OUTSIDE_ALLOWED_ROOT" }
        elseif ($_.Exception.Message -like "RUNTIME_IDENTITY_INVALID*") { $lifecycleCode = "RUNTIME_IDENTITY_INVALID" }
        [void]$errors.Add([pscustomobject]@{ code = $lifecycleCode; category = "lifecycle"; message = $_.Exception.ToString(); exception_type = $_.Exception.GetType().FullName; script_stack_trace = $_.ScriptStackTrace })
        if ($null -eq $primaryFault) {
            $primaryFault = [pscustomobject]@{ injection = "lifecycle"; code = $lifecycleCode }
        }
    }
    finally {
        try {
        try { $environmentAfter = Copy-FoundationEnvironmentSnapshot (& $EnvironmentAdapter ([pscustomobject]@{ operation = "snapshot"; scope = "process" })) }
        catch { $environmentAfter = [pscustomobject]@{ success = $false; entries = @(); error_type = $_.Exception.GetType().FullName; error_text = $_.Exception.ToString() } }
        $beforeView = Get-FoundationEnvironmentAuditView $environmentBefore
        $afterView = Get-FoundationEnvironmentAuditView $environmentAfter
        $report.environment.before_fingerprint = $beforeView.fingerprint
        $report.environment.after_fingerprint = $afterView.fingerprint
        $report.environment.before_names = @($beforeView.names)
        $report.environment.after_names = @($afterView.names)
        $report.environment.before_value_hashes = @($beforeView.value_hashes)
        $report.environment.after_value_hashes = @($afterView.value_hashes)
        if ($null -ne $environmentBefore -and [bool]$environmentBefore.success -and $null -ne $environmentAfter -and [bool]$environmentAfter.success) {
            $unchanged = [string]$beforeView.fingerprint -eq [string]$afterView.fingerprint
            $report.environment.caller_unchanged = $unchanged
            $report.environment.restored = $unchanged
            $report.environment.verification_status = if ($unchanged) { "verified" } else { "failed" }
            if (-not $unchanged) {
                [void]$errors.Add([pscustomobject]@{ code = "environment_changed"; category = "environment"; message = "Caller process environment changed" })
                if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "caller_environment_changed"; code = "environment_changed" } }
            }
        }
        else {
            $report.environment.caller_unchanged = $null
            $report.environment.restored = $null
            $report.environment.verification_status = "failed"
            if (-not (@($errors | Where-Object { $_.code -eq "environment_snapshot_failed" }).Count -gt 0)) {
                [void]$errors.Add([pscustomobject]@{ code = "environment_snapshot_failed"; category = "environment"; message = [string]$environmentAfter.error_text })
            }
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "after_environment_snapshot_failure"; code = "environment_snapshot_failed" } }
        }
        }
        catch {
            $report.environment.caller_unchanged = $null
            $report.environment.restored = $null
            $report.environment.verification_status = "failed"
            [void]$errors.Add([pscustomobject]@{ code = "environment_snapshot_failed"; category = "environment"; message = $_.Exception.ToString() })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "after_environment_snapshot_failure"; code = "environment_snapshot_failed" } }
        }

        try {
        $openclawAudit = $emptyManifest
        $openclawAuditCompleted = $false
        $openclawAuditErrorType = $null
        $openclawAuditErrorText = $null
        try {
            $openclawAudit = & $invokeManifest ([pscustomobject]@{ scope_id = "openclaw_pre_delete_audit"; roots = @([pscustomobject]@{ root_id = "openclaw_state_root"; path = $rootMap.openclaw_state_root }); exclude_node_modules = $false; include_dist = $true; all_files = $true; creation_stage_by_path = $creationStages })
            $openclawAuditCompleted = $true
        }
        catch {
            $openclawAuditErrorType = $_.Exception.GetType().FullName
            $openclawAuditErrorText = $_.Exception.ToString()
            [void]$errors.Add([pscustomobject]@{ code = "manifest_failed"; category = "audit"; message = $_.Exception.ToString(); scope_id = "openclaw_pre_delete_audit" })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "manifest_provider_scope_throw"; code = "manifest_failed" } }
        }
        $openBusiness = @($openclawAudit.entries | Where-Object { $_.classification -eq "business_candidate" })
        $openInternal = @($openclawAudit.entries | Where-Object { $_.classification -eq "openclaw_internal_tool_state" })
        $openOther = @($openclawAudit.entries | Where-Object { $_.classification -eq "other" })
        $report.openclaw_state.pre_delete_audit = [pscustomobject]@{
            completed = [bool]$openclawAuditCompleted
            entries = @($openclawAudit.entries)
            business_entries = @($openBusiness)
            internal_state_entries = @($openInternal)
            other_entries = @($openOther)
            business_candidate_count = $openBusiness.Count
            openclaw_internal_tool_state_count = $openInternal.Count
            other_count = $openOther.Count
            error_type = $openclawAuditErrorType
            error_text = $openclawAuditErrorText
        }
        foreach ($entry in @($report.openclaw_state.pre_delete_audit.entries | Where-Object { [string]$_.creation_stage -ceq "post_command_unattributed" })) {
            [void]$errors.Add([pscustomobject]@{ code = "OPENCLAW_CREATION_STAGE_UNKNOWN"; category = "audit"; message = "OpenClaw file was first observed after the final plugin command"; path = [string]$entry.full_path })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "openclaw_creation_stage_unknown"; code = "OPENCLAW_CREATION_STAGE_UNKNOWN" } }
        }
        $report.business_impact.openclaw_business_candidate_count = $openBusiness.Count
        if ($openBusiness.Count -gt 0) {
            [void]$errors.Add([pscustomobject]@{ code = "OPENCLAW_BUSINESS_CANDIDATE"; category = "audit"; message = "OpenClaw run root contains business candidates"; paths = @($openBusiness.full_path) })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "non_allowlisted_openclaw_business_files"; code = "OPENCLAW_BUSINESS_CANDIDATE" } }
        }
        }
        catch {
            $report.openclaw_state.pre_delete_audit = [pscustomobject]@{ completed = $false; entries = @(); business_entries = @(); internal_state_entries = @(); other_entries = @(); business_candidate_count = 0; openclaw_internal_tool_state_count = 0; other_count = 0; error_type = $_.Exception.GetType().FullName; error_text = $_.Exception.ToString() }
            [void]$errors.Add([pscustomobject]@{ code = "manifest_failed"; category = "audit"; message = $_.Exception.ToString(); scope_id = "openclaw_pre_delete_audit" })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "openclaw_pre_delete_audit"; code = "manifest_failed" } }
        }

        try {
        $temporaryBusinessCount = 0
        $policyJournalAuditEntries = @(Get-FoundationFreshPolicyJournalAuditEntries -Specifications $specs -Commands @($commands))
        $policyJournalEntriesByRoot = @{}
        foreach ($temporaryReport in @($temporaryReports)) {
            $policyJournalEntriesByRoot[[string]$temporaryReport.root_id] = New-Object System.Collections.ArrayList
        }
        foreach ($policyEntry in @($policyJournalAuditEntries)) {
            $matchingRoots = @($temporaryReports | Where-Object {
                Test-FoundationPathContained -Parent ([string]$_.path) -Candidate ([string]$policyEntry.full_path)
            })
            if ($matchingRoots.Count -ne 1) { throw "MANIFEST_ENTRY_INVALID:policy_journal_root:$($policyEntry.full_path)" }
            [void]$policyJournalEntriesByRoot[[string]$matchingRoots[0].root_id].Add($policyEntry)
        }
        foreach ($temporaryReport in @($temporaryReports)) {
            if ($temporaryReport.root_id -eq "openclaw_state_root") {
                if ([bool]$report.openclaw_state.pre_delete_audit.completed) {
                    foreach ($policyEntry in @($policyJournalEntriesByRoot[[string]$temporaryReport.root_id])) {
                        $matches = @($report.openclaw_state.pre_delete_audit.entries | Where-Object {
                            ([string]$_.full_path).Equals([string]$policyEntry.full_path, [System.StringComparison]::OrdinalIgnoreCase)
                        })
                        if ($matches.Count -ne 1) { throw "MANIFEST_ENTRY_INCOMPLETE:policy_journal:$($policyEntry.full_path)" }
                        if ([long]$matches[0].length -ne [long]$policyEntry.length -or
                            [string]$matches[0].sha256 -cne [string]$policyEntry.sha256 -or
                            [string]$matches[0].last_write_time_utc -cne [string]$policyEntry.last_write_time_utc) {
                            throw "MANIFEST_ENTRY_INVALID:policy_journal:$($policyEntry.full_path)"
                        }
                    }
                }
                $temporaryReport.pre_delete_audit = [pscustomobject]@{
                    completed = [bool]$report.openclaw_state.pre_delete_audit.completed
                    audit_ref = "/openclaw_state/pre_delete_audit"
                    business_candidate_count = [int]$report.openclaw_state.pre_delete_audit.business_candidate_count
                    openclaw_internal_tool_state_count = [int]$report.openclaw_state.pre_delete_audit.openclaw_internal_tool_state_count
                    other_count = [int]$report.openclaw_state.pre_delete_audit.other_count
                }
                $temporaryBusinessCount += [int]$report.openclaw_state.pre_delete_audit.business_candidate_count
                continue
            }
            try {
                $auditRequest = [pscustomobject]@{ scope_id = ("temporary_" + $temporaryReport.root_id + "_pre_delete"); roots = @([pscustomobject]@{ root_id = $temporaryReport.root_id; path = $temporaryReport.path }); exclude_node_modules = $false; include_dist = $true; all_files = $false }
                if ([string]$temporaryReport.root_id -ceq "validation_root" -and $null -eq $ManifestProvider) {
                    $audit = & $invokeManifest $auditRequest @([string]$layout.runtime_snapshot_root)
                }
                else {
                    $audit = & $invokeManifest $auditRequest
                }
                $entryIndex = @{}
                foreach ($entry in @($audit.entries)) {
                    $entryPath = ConvertTo-FoundationStrictLocalPath ([string]$entry.full_path)
                    $entryKey = $entryPath.ToUpperInvariant()
                    if ($entryIndex.ContainsKey($entryKey)) { throw "MANIFEST_ENTRY_INVALID:duplicate:$entryPath" }
                    $entryIndex[$entryKey] = $entry
                }
                foreach ($policyEntry in @($policyJournalEntriesByRoot[[string]$temporaryReport.root_id])) {
                    $entryPath = ConvertTo-FoundationStrictLocalPath ([string]$policyEntry.full_path)
                    $entryKey = $entryPath.ToUpperInvariant()
                    if ($entryIndex.ContainsKey($entryKey)) {
                        $existing = $entryIndex[$entryKey]
                        if ([long]$existing.length -ne [long]$policyEntry.length -or
                            [string]$existing.sha256 -cne [string]$policyEntry.sha256 -or
                            [string]$existing.last_write_time_utc -cne [string]$policyEntry.last_write_time_utc) {
                            throw "MANIFEST_ENTRY_INVALID:policy_journal:$entryPath"
                        }
                        continue
                    }
                    $entryIndex[$entryKey] = [pscustomobject][ordered]@{
                        full_path = $entryPath
                        relative_path = Get-FoundationRelativePath -Root ([string]$temporaryReport.path) -Path $entryPath
                        root_labels = @([string]$temporaryReport.root_id)
                        length = [long]$policyEntry.length
                        sha256 = [string]$policyEntry.sha256
                        last_write_time_utc = [string]$policyEntry.last_write_time_utc
                        classification = "other"
                        candidate_kind = $null
                        creation_stage = [string]$policyEntry.creation_stage
                    }
                }
                $entryKeys = New-Object 'System.Collections.Generic.List[string]'
                foreach ($entryKey in @($entryIndex.Keys)) { $entryKeys.Add([string]$entryKey) }
                $entryKeys.Sort([System.StringComparer]::OrdinalIgnoreCase)
                $mergedEntries = New-Object System.Collections.ArrayList
                foreach ($entryKey in @($entryKeys)) { [void]$mergedEntries.Add($entryIndex[[string]$entryKey]) }
                $temporaryReport.pre_delete_audit = [pscustomobject]@{ completed = $true; entries = @($mergedEntries); business_candidate_count = @($mergedEntries | Where-Object { $_.classification -eq "business_candidate" }).Count }
                $temporaryBusinessCount += [int]$temporaryReport.pre_delete_audit.business_candidate_count
            }
            catch {
                $temporaryReport.pre_delete_audit = [pscustomobject]@{ completed = $false; entries = @(); business_candidate_count = 0; error_text = $_.Exception.ToString() }
                [void]$errors.Add([pscustomobject]@{ code = "manifest_failed"; category = "audit"; message = $_.Exception.ToString(); root_id = $temporaryReport.root_id })
                if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "manifest_provider_scope_throw"; code = "manifest_failed" } }
            }
        }
        $report.business_impact.temporary_business_candidate_count = $temporaryBusinessCount
        if ($temporaryBusinessCount -gt 0) {
            [void]$errors.Add([pscustomobject]@{ code = "TEMPORARY_BUSINESS_CANDIDATE"; category = "audit"; message = "Temporary roots contain business candidates" })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "runtime_business_candidates"; code = "TEMPORARY_BUSINESS_CANDIDATE" } }
        }
        }
        catch {
            [void]$errors.Add([pscustomobject]@{ code = "manifest_failed"; category = "audit"; message = $_.Exception.ToString(); scope_id = "temporary_pre_delete_audits" })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "temporary_pre_delete_audits"; code = "manifest_failed" } }
        }

        $finallyBeforeCleanupHandles = New-Object System.Collections.ArrayList
        try {
            $latestInputSpecByRoot = [ordered]@{}
            foreach ($candidateSpec in @($specs | Where-Object { $commandInputIdentities.ContainsKey([string]$_.id) })) {
                $inputRootKey = if ([string]::IsNullOrWhiteSpace([string]$candidateSpec.staging_root)) {
                    "command:" + [string]$candidateSpec.id
                }
                else {
                    "staging:" + (ConvertTo-FoundationStrictLocalPath ([string]$candidateSpec.staging_root)).ToUpperInvariant()
                }
                $latestInputSpecByRoot[$inputRootKey] = $candidateSpec
            }
            $frozenInputSpecs = @($latestInputSpecByRoot.Values)
            $finalRuntimeCheck = New-FoundationRuntimeIdentityCheck -Runtime $normalizedRuntime -SnapshotIdentity $snapshotIdentity -Phase "finally_before_cleanup" -IncludeSnapshot $true -PolicyModule $policyModule -RetainedHandles $finallyBeforeCleanupHandles -RetainRuntimeInputs $true -CommandSpecs $frozenInputSpecs -CommandInputExpectations $commandInputIdentities -Commands @($commands) -Specs @($specs) -RequireExecutionQuiescence $true -PathSecurityState $pathSecurityState -PathOperationPrefix "runtime_read:finally_before_cleanup"
            $report.runtime_identity.checks = @($report.runtime_identity.checks) + @($finalRuntimeCheck)
        }
        catch {
            $finalCode = if ($_.Exception.Message -match '(PROCESS_[A-Z_]+)') { [string]$Matches[1] } elseif ($_.Exception.Message -match '(TRUSTED_POLICY_[A-Z_]+_INVALID)') { [string]$Matches[1] } else { "RUNTIME_IDENTITY_INVALID" }
            $report.runtime_identity.checks = @($report.runtime_identity.checks) + @([pscustomobject][ordered]@{ phase = "finally_before_cleanup"; command_id = $null; matched = $false; error_code = $finalCode; source_tree_sha256 = $null; snapshot_tree_sha256 = $null; snapshot_check_applicable = $true; pinned_input_count = Get-FoundationLivePinnedInputCount -Handles $finallyBeforeCleanupHandles -PolicyModule $policyModule })
            [void]$errors.Add([pscustomobject]@{ code = $finalCode; category = "runtime"; message = $_.Exception.ToString() })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "finally_before_cleanup"; code = $finalCode } }
        }
        finally {
            Close-FoundationHandleCollection $finallyBeforeCleanupHandles
        }
        Close-FoundationPolicyModule $policyModule
        $policyModule = $null
        foreach ($definition in $rootDefinitions) {
            $temporaryReport = @($temporaryReports | Where-Object { $_.root_id -eq $definition.root_id })[0]
            $registeredIdentity = $null
            if ($null -ne $definition.PSObject.Properties["path_identity"]) { $registeredIdentity = $definition.path_identity }
            $cleanupSpec = [pscustomobject]@{ root_id = $definition.root_id; path = $definition.path; trusted_parent = $definition.trusted_parent; task_id = $taskId; run_id = $runId; path_identity = $registeredIdentity }
            $cleanupParentPins = $null
            $cleanupEntryState = $null
            $cleanupOperationPins = @()
            $cleanupPinOperationId = "cleanup_dispose:" + [string]$definition.root_id + ":pin"
            $residualOperationId = "residual_scan:" + [string]$definition.root_id
            try {
                $cleanupParentPins = New-FoundationPinnedPathChain -Path ([string]$definition.trusted_parent) -ShareWrite $true -AllowMissing $false
                if ($null -eq $registeredIdentity) {
                    $cleanup = [pscustomobject][ordered]@{ attempted = $false; succeeded = $false; residual_count = 0; error_type = "CLEANUP_ROOT_NOT_REGISTERED"; error_text = "Run root creation identity was not frozen" }
                }
                else {
                    $cleanupEntryState = Get-FoundationNativePathState -Path ([string]$definition.path) -ShareWrite $true
                    if (-not [bool]$cleanupEntryState.exists) {
                        [void](Add-FoundationPathSecurityOperation -State $pathSecurityState -OperationId $cleanupPinOperationId -OperationKind "cleanup_dispose" -Phase "pin" -PinnedPaths @($cleanupParentPins.pins) -ImmutableInputCount 0 -Succeeded $false -ErrorCode "PATH_IDENTITY_CHANGED")
                        throw "PATH_IDENTITY_CHANGED:$($definition.path)"
                    }
                    $entryInfo = $cleanupEntryState.info
                    if ([string]$entryInfo.VolumeSerial -cne [string]$registeredIdentity.volume_serial -or [string]$entryInfo.FileId -cne [string]$registeredIdentity.file_id) {
                        throw "PATH_IDENTITY_CHANGED:$($definition.path)"
                    }
                    $entryPin = [pscustomobject][ordered]@{
                        path = [string]$cleanupEntryState.path; volume_serial = [string]$entryInfo.VolumeSerial; file_id = [string]$entryInfo.FileId
                        attributes = [uint32]$entryInfo.Attributes; share_write = $true; share_delete = $false; handle = $cleanupEntryState.handle
                    }
                    $cleanupOperationPins = @(Copy-FoundationPathPinRows (@($cleanupParentPins.pins) + @($entryPin)))
                    try {
                        Invoke-FoundationPathPhaseObserver -Observer $PathPhaseObserver -Phase "cleanup_after_entry_pin_before_dispose" -OperationId $cleanupPinOperationId -PinnedPaths $cleanupOperationPins -TargetPath ([string]$definition.path)
                        [void](Add-FoundationPathSecurityOperation -State $pathSecurityState -OperationId $cleanupPinOperationId -OperationKind "cleanup_dispose" -Phase "pin" -PinnedPaths $cleanupOperationPins -ImmutableInputCount 0 -Succeeded $true)
                    }
                    catch {
                        if (-not $pathSecurityState.operation_ids.Contains($cleanupPinOperationId)) {
                            [void](Add-FoundationPathSecurityOperation -State $pathSecurityState -OperationId $cleanupPinOperationId -OperationKind "cleanup_dispose" -Phase "pin" -PinnedPaths $cleanupOperationPins -ImmutableInputCount 0 -Succeeded $false -ErrorCode (Get-FoundationPathOperationErrorCode $_.Exception.ToString()))
                        }
                        throw
                    }
                    $cleanupEntryState.handle.Dispose()
                    $cleanupEntryState = $null
                    try { $cleanup = Copy-FoundationCleanupAdapterResult (& $CleanupRunner $cleanupSpec) }
                    catch { $cleanup = [pscustomobject][ordered]@{ attempted = $true; succeeded = $false; residual_count = 1; error_type = $_.Exception.GetType().FullName; error_text = $_.Exception.ToString() } }
                }
                try {
                    $physicalResidual = Get-FoundationPhysicalResidual -TrustedParent ([string]$definition.trusted_parent) -Path ([string]$definition.path)
                    [void](Add-FoundationPathSecurityOperation -State $pathSecurityState -OperationId $residualOperationId -OperationKind "residual_scan" -Phase "complete" -PinnedPaths @($cleanupParentPins.pins) -ImmutableInputCount 0 -Succeeded $true)
                }
                catch {
                    if (-not $pathSecurityState.operation_ids.Contains($residualOperationId)) {
                        [void](Add-FoundationPathSecurityOperation -State $pathSecurityState -OperationId $residualOperationId -OperationKind "residual_scan" -Phase "complete" -PinnedPaths @($cleanupParentPins.pins) -ImmutableInputCount 0 -Succeeded $false -ErrorCode (Get-FoundationPathOperationErrorCode $_.Exception.ToString()))
                    }
                    $physicalResidual = [pscustomobject][ordered]@{
                        physical_residual_entries = @([pscustomobject][ordered]@{ path = [string]$definition.path; volume_serial = $null; file_id = $null; attributes = $null; entry_kind = "scan_error"; length = $null; error_type = $_.Exception.GetType().FullName; error_text = $_.Exception.ToString() })
                        physical_residual_count = 1
                    }
                }
            }
            catch {
                $cleanup = [pscustomobject][ordered]@{ attempted = $false; succeeded = $false; residual_count = 1; error_type = $_.Exception.GetType().FullName; error_text = $_.Exception.ToString() }
                $physicalResidual = [pscustomobject][ordered]@{
                    physical_residual_entries = @([pscustomobject][ordered]@{ path = [string]$definition.path; volume_serial = $null; file_id = $null; attributes = $null; entry_kind = "scan_error"; length = $null; error_type = $_.Exception.GetType().FullName; error_text = $_.Exception.ToString() })
                    physical_residual_count = 1
                }
            }
            finally {
                if ($null -ne $cleanupEntryState -and $null -ne $cleanupEntryState.handle) { $cleanupEntryState.handle.Dispose() }
                Close-FoundationPinSet $cleanupParentPins
            }
            $residual = [int]$physicalResidual.physical_residual_count
            $temporaryReport.cleanup = $cleanup
            $temporaryReport.physical_residual_entries = @($physicalResidual.physical_residual_entries)
            $temporaryReport.physical_residual_count = $residual
            $cleanupMatched = ($null -ne $cleanup -and [bool]$cleanup.attempted -and [bool]$cleanup.succeeded -and
                [int]$cleanup.residual_count -eq $residual -and $residual -eq 0 -and
                [string]::IsNullOrWhiteSpace([string]$cleanup.error_type) -and [string]::IsNullOrWhiteSpace([string]$cleanup.error_text))
            [void](Add-FoundationPathSecurityOperation -State $pathSecurityState -OperationId ("cleanup_dispose:" + [string]$definition.root_id + ":complete") -OperationKind "cleanup_dispose" -Phase "complete" -PinnedPaths $cleanupOperationPins -ImmutableInputCount 0 -Succeeded ([bool]$cleanupMatched) -ErrorCode $(if ($cleanupMatched) { $null } else { "PATH_OPERATION_FAILED" }))
            if (-not $cleanupMatched) {
                [void]$errors.Add([pscustomobject]@{ code = "TEMP_ROOT_CLEANUP_FAILED"; category = "cleanup"; root_id = $definition.root_id; error_type = [string]$cleanup.error_type; message = ([string]$cleanup.error_type + ":" + [string]$cleanup.error_text) })
                if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = ("cleanup:" + $definition.root_id); code = "TEMP_ROOT_CLEANUP_FAILED" } }
            }
            if ($definition.root_id -eq "openclaw_state_root") {
                foreach ($internalEntry in @($report.openclaw_state.pre_delete_audit.internal_state_entries)) {
                    $entryResidual = @($temporaryReport.physical_residual_entries | Where-Object { ([string]$_.path).Equals([string]$internalEntry.full_path, [System.StringComparison]::OrdinalIgnoreCase) }).Count
                    $entrySucceeded = ($null -ne $cleanup -and [bool]$cleanup.attempted -and $entryResidual -eq 0)
                    $entryErrorType = $null
                    $entryErrorText = $null
                    if (-not $entrySucceeded) {
                        $entryErrorType = if ($null -ne $cleanup -and -not [string]::IsNullOrWhiteSpace([string]$cleanup.error_type)) { [string]$cleanup.error_type } else { "TEMP_ROOT_CLEANUP_FAILED" }
                        $entryErrorText = if ($null -ne $cleanup -and -not [string]::IsNullOrWhiteSpace([string]$cleanup.error_text)) { [string]$cleanup.error_text } else { "OpenClaw internal state file remained after cleanup" }
                    }
                    $internalEntry | Add-Member -NotePropertyName cleanup_result -NotePropertyValue ([pscustomobject]@{ attempted = ($null -ne $cleanup -and [bool]$cleanup.attempted); succeeded = [bool]$entrySucceeded; residual_count = $entryResidual; error_type = $entryErrorType; error_text = $entryErrorText }) -Force
                }
            }
        }
        $openclawCleanupRows = @($temporaryReports | Where-Object { $_.root_id -eq "openclaw_state_root" })
        $report.openclaw_state.cleanup = if ($openclawCleanupRows.Count -eq 1) { $openclawCleanupRows[0].cleanup } else { $null }

        try {
        $officialAfterErrorCount = $errors.Count
        $officialAfter = Invoke-FoundationOfficialStateObservation -ScopeId "official_after" -ProjectRoot $project -OfficialRoots $officialRoots -ManifestInvoker $invokeManifest -ErrorSink $errors
        if ($errors.Count -gt $officialAfterErrorCount -and $null -eq $primaryFault) {
            $newOfficialErrors = @($errors | Select-Object -Skip $officialAfterErrorCount)
            $officialCode = [string]$newOfficialErrors[0].code
            $officialInjection = "official_observation_failure"
            if ($officialCode -eq "manifest_failed") { $officialInjection = "manifest_provider_scope_throw" }
            $primaryFault = [pscustomobject]@{ injection = $officialInjection; code = $officialCode }
        }
        $officialDiff = Get-FoundationOfficialObservationDiff $officialBefore $officialAfter
        $report.manifests.official.after = $officialAfter
        $report.manifests.official.diff = $officialDiff
        $report.business_impact.official_added = @($officialDiff.added).Count
        $report.business_impact.official_modified = @($officialDiff.modified).Count
        $report.business_impact.official_deleted = @($officialDiff.deleted).Count
        if (@($officialDiff.added).Count -gt 0) {
            [void]$errors.Add([pscustomobject]@{ code = "OFFICIAL_DATA_ADDED"; category = "manifest"; message = "Official business data was added" })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "add_sqlite_wal"; code = "OFFICIAL_DATA_ADDED" } }
        }
        if (@($officialDiff.modified).Count -gt 0) {
            [void]$errors.Add([pscustomobject]@{ code = "OFFICIAL_DATA_MODIFIED"; category = "manifest"; message = "Official business data was modified" })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "modify_jsonl"; code = "OFFICIAL_DATA_MODIFIED" } }
        }
        if (@($officialDiff.deleted).Count -gt 0) {
            [void]$errors.Add([pscustomobject]@{ code = "OFFICIAL_DATA_DELETED"; category = "manifest"; message = "Official business data was deleted" })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "delete_db_journal"; code = "OFFICIAL_DATA_DELETED" } }
        }
        }
        catch {
            $officialAfter = $emptyOfficialAfter
            $officialDiff = $emptyDiff
            $report.manifests.official.after = $officialAfter
            $report.manifests.official.diff = $officialDiff
            [void]$errors.Add([pscustomobject]@{ code = "manifest_failed"; category = "manifest"; message = $_.Exception.ToString(); scope_id = "official_after" })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "official_observation_failure"; code = "manifest_failed" } }
        }

        try {
        $projectAfterErrorCount = $errors.Count
        $projectCandidateAfter = Invoke-FoundationProjectCandidateObservation -ScopeId "project_business_candidates_after" -ProjectRoot $project -ProjectRoots $projectCandidateRoots -ManifestInvoker $invokeManifest -ErrorSink $errors
        if (-not [bool]$projectCandidateAfter.completed -and $errors.Count -eq $projectAfterErrorCount) {
            [void]$errors.Add([pscustomobject]@{ code = "PROJECT_BUSINESS_CANDIDATE_OBSERVATION_INCOMPLETE"; category = "manifest"; message = "Project business candidate after observation is incomplete"; scope_id = "project_business_candidates_after" })
        }
        if ($errors.Count -gt $projectAfterErrorCount -and $null -eq $primaryFault) {
            $newProjectErrors = @($errors | Select-Object -Skip $projectAfterErrorCount)
            $projectCode = [string]$newProjectErrors[0].code
            $projectInjection = "project_business_candidate_observation"
            if ($projectCode -eq "manifest_failed") { $projectInjection = "manifest_provider_scope_throw" }
            $primaryFault = [pscustomobject]@{ injection = $projectInjection; code = $projectCode }
        }
        $projectCandidateDiff = Get-FoundationProjectCandidateDiff $projectCandidateBefore $projectCandidateAfter
        $report.manifests.project_business_candidates.after = $projectCandidateAfter
        $report.manifests.project_business_candidates.diff = $projectCandidateDiff
        $report.business_impact.project_candidate_added = @($projectCandidateDiff.added).Count
        $report.business_impact.project_candidate_modified = @($projectCandidateDiff.modified).Count
        $report.business_impact.project_candidate_deleted = @($projectCandidateDiff.deleted).Count
        if (@($projectCandidateDiff.added).Count -gt 0) {
            [void]$errors.Add([pscustomobject]@{ code = "PROJECT_BUSINESS_CANDIDATE_ADDED"; category = "manifest"; message = "Project business candidate was added" })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "project_only_dist_sidecar_add"; code = "PROJECT_BUSINESS_CANDIDATE_ADDED" } }
        }
        if (@($projectCandidateDiff.modified).Count -gt 0) {
            [void]$errors.Add([pscustomobject]@{ code = "PROJECT_BUSINESS_CANDIDATE_MODIFIED"; category = "manifest"; message = "Project business candidate was modified" })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "project_business_candidate_modify"; code = "PROJECT_BUSINESS_CANDIDATE_MODIFIED" } }
        }
        if (@($projectCandidateDiff.deleted).Count -gt 0) {
            [void]$errors.Add([pscustomobject]@{ code = "PROJECT_BUSINESS_CANDIDATE_DELETED"; category = "manifest"; message = "Project business candidate was deleted" })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "project_business_candidate_delete"; code = "PROJECT_BUSINESS_CANDIDATE_DELETED" } }
        }
        }
        catch {
            $projectCandidateAfter = $emptyProjectAfter
            $projectCandidateDiff = $emptyDiff
            $report.manifests.project_business_candidates.after = $projectCandidateAfter
            $report.manifests.project_business_candidates.diff = $projectCandidateDiff
            [void]$errors.Add([pscustomobject]@{ code = "manifest_failed"; category = "manifest"; message = $_.Exception.ToString(); scope_id = "project_business_candidates_after" })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "project_business_candidate_observation"; code = "manifest_failed" } }
        }

        foreach ($route in @("B", "C")) {
            $path = [string]$sourceDistPaths[$route]
            $scopeId = "source_dist_${route}_after"
            try {
                $sourceRaw = Set-FoundationSourceDistEntryClassification (& $invokeManifest ([pscustomobject]@{ scope_id = $scopeId; roots = @([pscustomobject]@{ root_id = "source_dist_$route"; path = $path }); exclude_node_modules = $false; include_dist = $true; all_files = $true }))
                $after = Copy-FoundationManifestObservation $sourceRaw $true
            }
            catch {
                $sourceDistExists = $false
                try { if (-not [string]::IsNullOrWhiteSpace($path)) { $sourceDistExists = [bool](Test-Path -LiteralPath $path) } } catch { }
                $after = [pscustomobject]@{ scope_id = $scopeId; completed = $false; roots = @([pscustomobject]@{ root_id = "source_dist_$route"; path = $path; exists = $sourceDistExists }); entries = @() }
                [void]$errors.Add([pscustomobject]@{ code = "manifest_failed"; category = "manifest"; message = $_.Exception.ToString(); scope_id = $scopeId })
            }
            $diff = Get-FoundationManifestDiff $sourceBefore[$route] $after
            $sourceDistReport.PSObject.Properties[$route].Value.after = $after
            $sourceDistReport.PSObject.Properties[$route].Value.diff = $diff
            if (@($diff.added).Count + @($diff.modified).Count + @($diff.deleted).Count -gt 0) {
                [void]$errors.Add([pscustomobject]@{ code = "SOURCE_DIST_CHANGED"; category = "manifest"; route = $route; message = "Source dist changed" })
                if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "source_dist_changed"; code = "SOURCE_DIST_CHANGED" } }
            }
        }
        $report.manifests.source_dist = $sourceDistReport

        $guardReports = New-Object System.Collections.ArrayList
        foreach ($guard in $guardDefinitions) {
            try { $after = & $invokeManifest ([pscustomobject]@{ scope_id = ("guard_" + $guard.guard_id + "_after"); roots = @([pscustomobject]@{ root_id = $guard.guard_id; path = $guard.path }); exclude_node_modules = $false; include_dist = $true; all_files = $true }) }
            catch { $after = $emptyManifest; [void]$errors.Add([pscustomobject]@{ code = "manifest_failed"; category = "manifest"; message = $_.Exception.ToString(); scope_id = ("guard_" + $guard.guard_id + "_after") }) }
            $diff = Get-FoundationManifestDiff $guardBefore[$guard.guard_id] $after
            [void]$guardReports.Add([pscustomobject]@{ guard_id = $guard.guard_id; path = $guard.path; before = $guardBefore[$guard.guard_id]; after = $after; diff = $diff })
            if (@($diff.added).Count + @($diff.modified).Count + @($diff.deleted).Count -gt 0) {
                [void]$errors.Add([pscustomobject]@{ code = "EXTERNAL_GUARD_CHANGED"; category = "guard"; guard_id = $guard.guard_id; message = "External guard changed" })
                if ($null -eq $primaryFault) {
                    $injection = "plugin_writes_external_guard"
                    if ([string]$guard.guard_id -like "vitest_*") { $injection = "vitest_cache_guard_change" }
                    $primaryFault = [pscustomobject]@{ injection = $injection; code = "EXTERNAL_GUARD_CHANGED" }
                }
            }
        }
        $report.external_guards = @($guardReports)
        try {
            $sourceFinalCheck = New-FoundationRuntimeIdentityCheck -Runtime $normalizedRuntime -SnapshotIdentity $snapshotIdentity -Phase "source_final_after_cleanup" -IncludeSnapshot $false -PathSecurityState $pathSecurityState -PathOperationPrefix "runtime_read:source_final_after_cleanup"
            $report.runtime_identity.checks = @($report.runtime_identity.checks) + @($sourceFinalCheck)
        }
        catch {
            $report.runtime_identity.checks = @($report.runtime_identity.checks) + @([pscustomobject][ordered]@{ phase = "source_final_after_cleanup"; command_id = $null; matched = $false; error_code = "RUNTIME_IDENTITY_INVALID"; source_tree_sha256 = $null; snapshot_tree_sha256 = $null; snapshot_check_applicable = $false; pinned_input_count = 0 })
            [void]$errors.Add([pscustomobject]@{ code = "RUNTIME_IDENTITY_INVALID"; category = "runtime"; message = $_.Exception.ToString() })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "source_final_after_cleanup"; code = "RUNTIME_IDENTITY_INVALID" } }
        }
        $report.temporary_roots = @($temporaryReports)
        $report.staging = @($stagingReports)
        try {
            $report.environment.command_profiles = @(New-FoundationCommandProfileReportRows -Specifications $specs -Layout $layout)
        }
        catch {
            $report.environment.command_profiles = @()
            [void]$errors.Add([pscustomobject]@{ code = "COMMAND_SPECIFICATION_FAILED"; category = "runtime"; message = $_.Exception.ToString() })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "command_profile_report"; code = "COMMAND_SPECIFICATION_FAILED" } }
        }
        try {
            if ($commands.Count -eq 0 -and $null -ne $layout -and $null -ne $normalizedRuntime -and $null -ne $snapshotIdentity) {
                $specs = @(New-FoundationCommandSpecifications -Layout $layout -Runtime $normalizedRuntime -SnapshotIdentity $snapshotIdentity)
                foreach ($spec in $specs) { [void]$commands.Add((New-FoundationCommandObject $spec)) }
            }
        }
        catch {
            [void]$errors.Add([pscustomobject]@{ code = "COMMAND_SPECIFICATION_FAILED"; category = "runtime"; message = $_.Exception.ToString() })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "command_specification"; code = "COMMAND_SPECIFICATION_FAILED" } }
        }
        $report.commands = @($commands)
        try { $report.artifacts = @(Get-FoundationArtifactRecords) }
        catch { [void]$errors.Add([pscustomobject]@{ code = "artifact_hash_failed"; category = "report"; message = $_.Exception.ToString() }); if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "artifact_hash"; code = "artifact_hash_failed" } } }
        try {
            $finishedAt = & $Clock
            if (-not ($finishedAt -is [datetimeoffset])) { throw "CLOCK_INVALID:finished_at" }
            $report.finished_at = $finishedAt
        }
        catch {
            $report.finished_at = $null
            [void]$errors.Add([pscustomobject]@{ code = "CLOCK_INVALID"; category = "clock"; phase = "finished_at"; message = $_.Exception.ToString() })
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "clock_finished_at"; code = "CLOCK_INVALID" } }
        }
        if ($null -ne $manifestSeenReferences) { $manifestSeenReferences.Clear() }
        $report.manifests.provider_dto.provider_objects_released = $true
        $report.errors = @($errors)
        if ($errors.Count -eq 0) { $report.verdict = "passed"; $report.exit_code = 0 } else { $report.verdict = "failed"; $report.exit_code = 1 }
        if ($report.verdict -eq "failed") {
            if ($null -eq $primaryFault) { $primaryFault = [pscustomobject]@{ injection = "unknown"; code = "foundation_validation_failed" } }
            if ([string]$officialBefore.schema_version -ceq "official-state-observation/v1") { $preHash = [string]$officialBefore.state_digest }
            else { $preHash = Get-FoundationStateDigest $stateBefore $stateBefore }
            if ([string]$officialAfter.schema_version -ceq "official-state-observation/v1") { $postHash = [string]$officialAfter.state_digest }
            else { $postHash = Get-FoundationStateDigest $stateBefore $stateAfter }
            $afterGenerated = $null -ne $report.manifests.official.after
            if ([string]$officialAfter.schema_version -ceq "official-state-observation/v1") {
                $afterGenerated = Test-FoundationOfficialAfterGenerated $officialBefore $officialAfter
            }
            $report.fault = New-FoundationFaultObject $primaryFault $preHash $postHash $officialDiff $afterGenerated
        }
    $publisherPreparation = $null
    $publisherResult = $null
    $publisherError = $null
    $publisherAdapterThrew = $false
    try {
        $publisherPreparation = New-FoundationPublicationPreparation -Report $report -EvidenceRoot $evidence -RunId $runId -PathSecurityState $pathSecurityState
        try {
            if ($null -eq $ReportPublisher) { $publisherCandidate = Invoke-FoundationDefaultReportPublisher $publisherPreparation.request -PathPhaseObserver $PathPhaseObserver }
            else { $publisherCandidate = & $ReportPublisher $publisherPreparation.request }
            if ($null -ne $publisherCandidate) { $publisherResult = Copy-FoundationPublisherResultPlainDto -Value $publisherCandidate }
        }
        catch {
            $publisherAdapterThrew = $true
            $publisherError = $_.Exception.ToString()
        }
        if ($null -eq $publisherResult -and [string]::IsNullOrWhiteSpace($publisherError)) {
            $publisherError = "Report publisher returned no result"
        }
        elseif ($null -ne $publisherResult -and -not [bool]$publisherResult.success) {
            $publisherFailures = New-Object System.Collections.ArrayList
            foreach ($artifactResult in @($publisherResult.artifact_results)) {
                $artifactErrorText = if ($null -eq $artifactResult.error_text) { $null } else { [string]$artifactResult.error_text }
                $artifactErrorType = if ($null -eq $artifactResult.error_type) { $null } else { [string]$artifactResult.error_type }
                if (-not [string]::IsNullOrWhiteSpace($artifactErrorText)) { [void]$publisherFailures.Add($artifactErrorText) }
                elseif (-not [string]::IsNullOrWhiteSpace($artifactErrorType)) { [void]$publisherFailures.Add($artifactErrorType) }
            }
            if ($publisherFailures.Count -gt 0) { $publisherError = @($publisherFailures) -join " | " }
            else { $publisherError = "Report publisher returned failure" }
        }
    }
    catch {
        $publisherError = $_.Exception.ToString()
    }

    try {
        if ($null -ne $publisherPreparation) {
            $publicationReview = Get-FoundationPublicationReview -Artifacts @($publisherPreparation.artifacts) -PublisherResult $publisherResult -PublisherError $publisherError
            foreach ($reviewError in @($publicationReview.review_errors)) { [void]$errors.Add($reviewError) }
            $report.raw_paths = @($publicationReview.raw_paths)
            $report.raw_sha256 = @($publicationReview.raw_sha256)
            $report | Add-Member -NotePropertyName publication -NotePropertyValue $publicationReview.publication -Force
            if ([string]$publicationReview.publication.status -ceq "complete") {
                $jsonArtifact = @($publicationReview.publication.artifacts | Where-Object { [string]$_.artifact_kind -ceq "machine_json" })[0]
                $report.report_path = [string]$jsonArtifact.published_path
                $report | Add-Member -NotePropertyName json_sha256 -NotePropertyValue ([string]$jsonArtifact.sha256) -Force
                $report.publisher_result = $publisherResult
            }
            else {
                $report.report_path = $null
                $report | Add-Member -NotePropertyName json_sha256 -NotePropertyValue $null -Force
                $report.publisher_result = $null
            }
        }
        else {
            $report.raw_paths = @()
            $report.raw_sha256 = @()
            $report.report_path = $null
            $report | Add-Member -NotePropertyName json_sha256 -NotePropertyValue $null -Force
            $report | Add-Member -NotePropertyName publication -NotePropertyValue ([pscustomobject][ordered]@{ status = "failed"; artifacts = @(); temporary_artifacts = @(); evidence_residual_count = 0 }) -Force
            $report.publisher_result = $null
        }
    }
    catch {
        if ([string]::IsNullOrWhiteSpace($publisherError)) { $publisherError = $_.Exception.ToString() }
        $report.raw_paths = @()
        $report.raw_sha256 = @()
        $report.report_path = $null
        $report | Add-Member -NotePropertyName json_sha256 -NotePropertyValue $null -Force
        $report | Add-Member -NotePropertyName publication -NotePropertyValue ([pscustomobject][ordered]@{ status = "failed"; artifacts = @(); temporary_artifacts = @(); evidence_residual_count = 0 }) -Force
        $report.publisher_result = $null
    }

    if ([string]$report.publication.status -cne "complete") {
        if ([string]::IsNullOrWhiteSpace($publisherError)) { $publisherError = "Publisher did not confirm every preregistered artifact" }
        [void]$errors.Add([pscustomobject]@{ code = "report_publish_failed"; category = "report"; message = $publisherError })
        if ($null -eq $primaryFault) {
            $injection = "report_publisher_failure"
            if ($publisherAdapterThrew -and $publisherError -match "publisher exception") { $injection = "report_publisher_throw" }
            $primaryFault = [pscustomobject]@{ injection = $injection; code = "report_publish_failed" }
        }
        $report.verdict = "failed"
        $report.exit_code = 1
        $report.errors = @($errors)
        if ([string]$officialBefore.schema_version -ceq "official-state-observation/v1") { $preHash = [string]$officialBefore.state_digest }
        else { $preHash = Get-FoundationStateDigest $stateBefore $stateBefore }
        if ([string]$officialAfter.schema_version -ceq "official-state-observation/v1") { $postHash = [string]$officialAfter.state_digest }
        else { $postHash = Get-FoundationStateDigest $stateBefore $stateAfter }
        $afterGenerated = $null -ne $report.manifests.official.after
        if ([string]$officialAfter.schema_version -ceq "official-state-observation/v1") {
            $afterGenerated = Test-FoundationOfficialAfterGenerated $officialBefore $officialAfter
        }
        $report.fault = New-FoundationFaultObject $primaryFault $preHash $postHash $report.manifests.official.diff $afterGenerated
    }
    }
    return $report
}
