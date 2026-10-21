using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
namespace SapuriSetup {
  static class Tests {
    static int count;
    static void Check(bool ok,string message){if(!ok)throw new Exception(message);count++;}
    static void Fails(Action action,string expected){try{action();}catch(Exception ex){Check(ex.Message.Contains(expected),"Wrong error: "+ex.Message);return;}throw new Exception("Expected failure: "+expected);}
    public static void Run(string folder){
      Directory.CreateDirectory(folder);
      try{
        string root=Path.Combine(folder,"isolated-"+Guid.NewGuid().ToString("N")),desktop=Path.Combine(root,"Desktop");Directory.CreateDirectory(desktop);
        var e=new Engine(Path.Combine(root,"Local","SAPURI POS"),desktop);
        var p=new Plan{Printer="ทดสอบ \"เครื่อง A\"",Chrome=Engine.FindChrome(),Width=80,Paper=new PaperChoice{Name="80 x 210 mm",RawKind=176,Width=283,Height=826},Id=Guid.NewGuid().ToString("N")};
        Check(p.Paper.Fits(80)&&!p.Paper.Fits(58),"72 mm printable area must fit an 80 mm roll only");
        var narrow=new PaperChoice{Name="58 mm",Width=189,Height=826,RawKind=7};Check(narrow.Fits(58)&&!narrow.Fits(80),"48 mm printable area must fit a 58 mm roll");
        Check(!new PaperChoice{Width=827,Height=1169}.Fits(80),"A4 must not be accepted for receipts");
        Fails(()=>Engine.ValidatePrinter(new Plan{Printer="Microsoft Print to PDF"}),"เครื่องพิมพ์ไฟล์");
        Fails(()=>Engine.ValidatePrinter(new Plan{Printer="Fax"}),"เครื่องพิมพ์ไฟล์");
        Fails(()=>Engine.ValidatePrinter(new Plan()),"กรุณาเลือก");
        Fails(()=>Engine.Quote("broken\"path"),"เส้นทาง");
        Check(e.Args(Engine.Url(p)).Contains("--kiosk-printing")&&e.Args(Engine.Url(p)).Contains("--user-data-dir=\""+e.Profile+"\""),"Shortcut uses dedicated profile and kiosk printing");
        Check(Engine.Url(p).Contains("sapuriPaper=80")&&Engine.Url(p).Contains(p.Id),"Preset URL matches the selected width");
        string preferences=Path.Combine(e.Profile,"Default","Preferences");Directory.CreateDirectory(Path.GetDirectoryName(preferences));
        File.WriteAllText(preferences,Engine.Serialize(Engine.Obj("profile",Engine.Obj("existing","keep"),"unrelated",42)));
        string sentinel=Path.Combine(e.Profile,"Default","offline-sales-sentinel");File.WriteAllText(sentinel,"do not touch");
        e.SaveProfile(p);
        var saved=Engine.Parse(File.ReadAllText(preferences));
        Check(Convert.ToInt32(saved["unrelated"])==42&&Convert.ToString(Engine.Child(saved,"profile")["existing"])=="keep","Existing preferences preserved");
        Check(File.ReadAllText(sentinel)=="do not touch","Offline data preserved");
        Check(Directory.GetFiles(Path.GetDirectoryName(preferences),"Preferences.backup-*").Length==1,"Backup made before replacing preferences");
        var state=Engine.Parse(Convert.ToString(Engine.Child(Engine.Child(saved,"printing"),"print_preview_sticky_settings")["appState"]));
        Check(Convert.ToString(Engine.Child(state,"mediaSize")["vendor_id"])=="176","Uses driver paper id");
        e.SaveShortcut(p);Check(File.Exists(e.Shortcut),"Shortcut created");e.CheckShortcut();
        e.SaveProfile(p);e.SaveShortcut(p);Check(File.Exists(sentinel),"Retry remains nondestructive");
        File.WriteAllText(preferences,"invalid json");Fails(()=>e.SaveProfile(p),"อ่านการตั้งค่า Chrome เดิมไม่ได้");Check(File.ReadAllText(preferences)=="invalid json","Corrupt existing preferences are not overwritten");
        File.WriteAllText(preferences,"{}");
        using(var locked=new FileStream(Path.Combine(e.Root,"setup.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None)) {bool blocked=false;try{e.SaveProfile(p);}catch(IOException){blocked=true;}Check(blocked,"Concurrent setup is blocked");}
        dynamic shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));dynamic link=shell.CreateShortcut(e.Shortcut);link.Arguments="--app=https://example.com";link.Save();
        Fails(()=>e.SaveProfile(p),"โปรแกรมอื่น");
        File.WriteAllText(Path.Combine(folder,"result.txt"),"PASS: "+count+" installer checks",System.Text.Encoding.UTF8);
      }catch(Exception ex){File.WriteAllText(Path.Combine(folder,"result.txt"),"FAIL: "+ex,System.Text.Encoding.UTF8);}
    }
  }
}
