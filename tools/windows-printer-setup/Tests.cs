using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;
namespace SapuriSetup {
  static class Tests {
    static int count;
    static void Check(bool ok,string message){if(!ok)throw new Exception(message);count++;}
    static void Fails(Action action,string expected){try{action();}catch(Exception ex){Check(ex.Message.Contains(expected),"Wrong error: "+ex.Message);return;}throw new Exception("Expected failure: "+expected);}
    static string Request(int port,string request){
      using(var client=new TcpClient("127.0.0.1",port)){
        client.ReceiveTimeout=5000;client.SendTimeout=5000;
        using(var stream=client.GetStream()){
          byte[] bytes=Encoding.ASCII.GetBytes(request);stream.Write(bytes,0,bytes.Length);
          using(var reader=new StreamReader(stream))return reader.ReadToEnd();
        }
      }
    }
    static void TestConnections(){
      var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();
      string token=Guid.NewGuid().ToString("N"),html="receipt-"+new string('x',512*1024);
      int port=((IPEndPoint)listener.LocalEndpoint).Port;
      var server=Task.Run(()=>Engine.WaitForPrint(listener,token,html,TimeSpan.FromSeconds(15),s=>{}));
      try{
        // Empty speculative connection; then EOF halfway through HTTP headers.
        using(var empty=new TcpClient("127.0.0.1",port)){}
        using(var partial=new TcpClient("127.0.0.1",port)){
          byte[] bytes=Encoding.ASCII.GetBytes("GET /"+token+"/test HTTP/1.1\r\nHost: localhost\r\n");partial.GetStream().Write(bytes,0,bytes.Length);
        }
        // Abort while the server is responding, reproducing the user's error.
        using(var reset=new TcpClient("127.0.0.1",port)){
          reset.LingerState=new LingerOption(true,0);
          byte[] bytes=Encoding.ASCII.GetBytes("GET /"+token+"/test HTTP/1.1\r\nHost: localhost\r\n\r\n");reset.GetStream().Write(bytes,0,bytes.Length);
        }
        Check(Request(port,"GET /"+token+"/test HTTP/1.1\r\nHost: localhost\r\n\r\n").EndsWith(html),"Test page survives empty, truncated and reset connections");
        Check(Request(port,"POST /wrong/done HTTP/1.1\r\nContent-Length: 0\r\n\r\n").StartsWith("HTTP/1.1 404"),"Unrelated requests cannot complete print test");
        Check(!server.IsCompleted,"Server continues waiting for genuine completion");
        Check(Request(port,"POST /"+token+"/done HTTP/1.1\r\nContent-Length: 0\r\n\r\n").EndsWith("ok"),"Completion acknowledged after recovered connection");
        server.GetAwaiter().GetResult();Check(true,"Recovered print session finishes successfully");
      }finally{listener.Stop();}
      var idle=new TcpListener(IPAddress.Loopback,0);idle.Start();
      try{Fails(()=>Engine.WaitForPrint(idle,"idle","test",TimeSpan.FromMilliseconds(100),s=>{}).GetAwaiter().GetResult(),"ยังไม่ได้รับผลทดสอบพิมพ์จาก Chrome");}finally{idle.Stop();}
    }
    public static void Run(string folder){
      Directory.CreateDirectory(folder);
      try{
        TestConnections();
        string root=Path.Combine(folder,"isolated-"+Guid.NewGuid().ToString("N")),desktop=Path.Combine(root,"Desktop");Directory.CreateDirectory(desktop);
        string pinned=Path.Combine(root,"TaskBar");Directory.CreateDirectory(pinned);
        var e=new Engine(Path.Combine(root,"Local","SAPURI POS"),desktop,Path.Combine(root,"Assets"),pinned);
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
        Check(e.Args(Engine.Url(p)).Contains("--profile-directory=\"Default\""),"Explicit profile skips Chrome profile picker");
        Check(ShellIdentity.Read(e.Shortcut,5)=="Chrome.pepo-pharmrcel.app_/.Chrome.Default","Shortcut identity matches Chromium URL app and dedicated profile (including component shortening)");
        Check(ShellIdentity.Read(e.Shortcut,2)==Engine.Quote(p.Chrome)+" "+e.Args(Engine.Url(p)),"Taskbar relaunch retains printer mode and SAPURI URL");
        Check(ShellIdentity.Read(e.Shortcut,3)==e.IconPath+",0","Taskbar relaunch uses SAPURI logo");
        using(var icon=new System.Drawing.Icon(e.IconPath,32,32))Check(icon.Width==32&&icon.Height==32,"Windows can decode the taskbar icon at native size");
        string pinPath=Path.Combine(pinned,"SAPURI POS.lnk"),chromePin=Path.Combine(pinned,"Google Chrome.lnk");
        File.Copy(e.Shortcut,pinPath);File.Copy(e.Shortcut,chromePin);
        dynamic pinShell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));dynamic ordinary=pinShell.CreateShortcut(chromePin);ordinary.Arguments="";ordinary.Save();
        byte[] untouched=File.ReadAllBytes(chromePin);
        dynamic oldPin=pinShell.CreateShortcut(pinPath);oldPin.Arguments="--user-data-dir="+Engine.Quote(e.Profile)+" --app="+Engine.Quote(Engine.Site);oldPin.Save();
        e.SaveProfile(p);e.SaveShortcut(p);Check(File.Exists(sentinel),"Retry remains nondestructive");
        Check(((string)pinShell.CreateShortcut(pinPath).Arguments).Contains("--kiosk-printing"),"Existing SAPURI pin repaired with printing arguments");
        Check(ShellIdentity.Read(pinPath,5)==ShellIdentity.AppId,"Existing pin retains matching app identity");
        Check(untouched.SequenceEqual(File.ReadAllBytes(chromePin)),"Ordinary Chrome pin remains byte-for-byte unchanged");
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
