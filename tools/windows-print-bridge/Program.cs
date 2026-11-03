using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace SapuriPrinting {
  static class Program {
    static readonly string Root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"SAPURI POS","Printing");
    [STAThread] static void Main(string[] args){
      Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
      try{
        if(args.Length==1&&args[0]=="--install"){Install();return;}
        if(args.Length==2&&args[0]=="--pair"){
          var match=Regex.Match(args[1],@"\Asapuri-print://pair/([a-f0-9]{64})/?\z");
          if(!match.Success)throw new InvalidOperationException("คำขอเชื่อมต่อตัวช่วยไม่ถูกต้อง");
          Directory.CreateDirectory(Root);
          using(var pairing=new Mutex(false,"Local\\SAPURI-Printing-Pair")){
            if(!pairing.WaitOne(5000))throw new InvalidOperationException("กำลังเชื่อมต่อ กรุณาลองใหม่");
            try{string file=Path.Combine(Root,"paired.json");var pairs=File.Exists(file)?Data.Read<List<string>>(File.ReadAllText(file)):new List<string>();
              string token=match.Groups[1].Value;if(!pairs.Contains(token)){pairs.Add(token);if(pairs.Count>20)pairs.RemoveAt(0);Data.Save(file,pairs);}
            }finally{pairing.ReleaseMutex();}
          }
        }
#if PRINT_TESTING
        if(args.Length==3&&args[0]=="--test-server"){
          Application.Run(new PrintHost(Path.GetFullPath(args[1]),Int32.Parse(args[2]),Path.Combine(Path.GetFullPath(args[1]),"exports")));return;
        }
#endif
        using(var running=new Mutex(false,"Local\\SAPURI-Printing-Bridge")){
          if(!running.WaitOne(0))return;
          try{Application.Run(new PrintHost(Root,Bridge.DefaultPort));}finally{running.ReleaseMutex();}
        }
      }catch(Exception ex){Environment.ExitCode=1;Directory.CreateDirectory(Root);File.AppendAllText(Path.Combine(Root,"errors.log"),DateTime.Now.ToString("s")+" "+ex+Environment.NewLine);MessageBox.Show("เปิดตัวช่วยพิมพ์ไม่ได้\n"+ex.Message,"SAPURI Print",MessageBoxButtons.OK,MessageBoxIcon.Error);}
    }
    static string Quote(string value){if(value.Contains("\"")||value.Contains("\r")||value.Contains("\n"))throw new InvalidOperationException("เส้นทางไม่ถูกต้อง");return "\""+value+"\"";}
    static void Install(){
      if(!Environment.Is64BitOperatingSystem)throw new InvalidOperationException("ชุดตั้งค่านี้รองรับ Windows 10/11 แบบ 64 บิต");
      try{Microsoft.Web.WebView2.Core.CoreWebView2Environment.GetAvailableBrowserVersionString();}
      catch{throw new InvalidOperationException("ไม่พบ Microsoft Edge WebView2 Runtime กรุณาติดตั้งจาก https://developer.microsoft.com/microsoft-edge/webview2 แล้วลองใหม่");}
      string source=Path.GetDirectoryName(Application.ExecutablePath),folder=Path.Combine(Root,"App-v3.0");
      var files=new[]{"SAPURI-Print.exe","Microsoft.Web.WebView2.Core.dll","Microsoft.Web.WebView2.WinForms.dll","WebView2Loader.dll","Sarabun-Regular.ttf","Sarabun-SemiBold.ttf","Sarabun-Bold.ttf","NotoSansThai.ttf","Sarabun-OFL.txt","NotoSansThai-OFL.txt","WebView2-LICENSE.txt"};
      foreach(string file in files)if(!File.Exists(Path.Combine(source,file)))throw new InvalidOperationException("ไฟล์ชุดตั้งค่าไม่ครบ กรุณาแตก ZIP ใหม่ก่อนเปิดชุดตั้งค่า");
      Directory.CreateDirectory(folder);
      foreach(string file in files){string target=Path.Combine(folder,file),from=Path.Combine(source,file);
        if(String.Equals(from,target,StringComparison.OrdinalIgnoreCase))continue;
        if(File.Exists(target)&&Data.Hash(Convert.ToBase64String(File.ReadAllBytes(target)))==Data.Hash(Convert.ToBase64String(File.ReadAllBytes(from))))continue;
        File.Copy(from,target,true);
      }
      string executable=Path.Combine(folder,"SAPURI-Print.exe");
      using(var protocol=Registry.CurrentUser.CreateSubKey(@"Software\Classes\sapuri-print")){
        protocol.SetValue("","URL:SAPURI Printing");protocol.SetValue("URL Protocol","");
        using(var command=protocol.CreateSubKey(@"shell\open\command"))command.SetValue("",Quote(executable)+" --pair \"%1\"");
      }
      using(var startup=Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))startup.SetValue("SAPURI Print",Quote(executable)+" --serve");
      // Import only the previously selected receipt printer; never guess A4/label printers.
      string settings=Path.Combine(Root,"printers.json"),legacy=Path.Combine(Path.GetDirectoryName(Root),"setup-settings.json");
      if(!File.Exists(settings)&&File.Exists(legacy)){
        var old=Data.Read<Dictionary<string,object>>(File.ReadAllText(legacy));object value;
        if(old.TryGetValue("printer",out value)&&!String.IsNullOrWhiteSpace(Convert.ToString(value)))Data.Save(settings,new Dictionary<string,Route>{{"receipt",new Route{printer=Convert.ToString(value)}}});
      }
      Process.Start(new ProcessStartInfo(executable,"--serve"){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden});
    }
  }
}
