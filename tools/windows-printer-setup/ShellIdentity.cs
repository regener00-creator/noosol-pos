using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace SapuriSetup {
  // Match Chromium's URL-app identity, so Explorer pins our complete shortcut
  // instead of a plain chrome.exe shortcut. No taskbar registry manipulation.
  public static class ShellIdentity {
    // Chromium limits each of these three components to (64 - 2) / 3 = 20
    // characters, keeping the first and last ten for the URL component.
    public const string AppId="Chrome.pepo-pharmrcel.app_/.Chrome.Default";
    [ComImport,Guid("00021401-0000-0000-C000-000000000046")] class ShellLink {}
    [StructLayout(LayoutKind.Sequential)] struct PropertyKey {
      public Guid format; public uint id;
      public PropertyKey(uint value){format=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");id=value;}
    }
    [StructLayout(LayoutKind.Explicit,Size=24)] struct Variant {
      [FieldOffset(0)] public ushort type;
      [FieldOffset(8)] public IntPtr pointer;
    }
    [ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface PropertyStore {
      void GetCount(out uint count); void GetAt(uint index,out PropertyKey key);
      void GetValue(ref PropertyKey key,out Variant value);
      void SetValue(ref PropertyKey key,ref Variant value); void Commit();
    }
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref Variant value);
    [DllImport("shell32.dll",CharSet=CharSet.Unicode)] static extern void SHChangeNotify(uint change,uint flags,string item,IntPtr other);
    static void Put(PropertyStore store,uint id,string text){
      var key=new PropertyKey(id);var value=new Variant{type=31,pointer=Marshal.StringToCoTaskMemUni(text)};
      try{store.SetValue(ref key,ref value);}finally{PropVariantClear(ref value);}
    }
    public static void Apply(string path,string command,string icon){
      object link=new ShellLink();
      try{
        var file=(IPersistFile)link;file.Load(path,2);var store=(PropertyStore)link;
        Put(store,5,AppId);Put(store,2,command);Put(store,3,icon);Put(store,4,"SAPURI POS");
        store.Commit();file.Save(path,true);
      }finally{Marshal.FinalReleaseComObject(link);}
      if(Read(path,5)!=AppId||Read(path,2)!=command)throw new InvalidOperationException("ตรวจตัวตนไอคอน Taskbar ไม่ผ่าน — ปิดหน้าต่าง Properties ของไอคอน แล้วลองใหม่");
      SHChangeNotify(0x2000,0x1005,path,IntPtr.Zero);
    }
    public static string Read(string path,uint id){
      object link=new ShellLink();
      try{
        ((IPersistFile)link).Load(path,0);var key=new PropertyKey(id);Variant value;
        ((PropertyStore)link).GetValue(ref key,out value);
        try{return value.type==31?Marshal.PtrToStringUni(value.pointer):"";}finally{PropVariantClear(ref value);}
      }finally{Marshal.FinalReleaseComObject(link);}
    }
  }
}
