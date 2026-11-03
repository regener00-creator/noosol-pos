using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Printing;
using System.IO;
using System.Linq;
using System.Management;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace SapuriPrinting {
  static class Printers {
    public static bool Virtual(string name){return Regex.IsMatch(name??"","PDF|XPS|OneNote|Fax",RegexOptions.IgnoreCase);}
    public static bool Offline(string name){
      using(var search=new ManagementObjectSearcher("SELECT Name,WorkOffline,PrinterStatus FROM Win32_Printer"))
        foreach(ManagementObject printer in search.Get())if(Convert.ToString(printer["Name"])==name)return Convert.ToBoolean(printer["WorkOffline"])||Convert.ToInt32(printer["PrinterStatus"])==7;
      return false;
    }
    public static void Validate(string name){
      if(!PrinterSettings.InstalledPrinters.Cast<string>().Contains(name))throw new InvalidOperationException("ไม่พบเครื่องพิมพ์ "+name+" ใน Windows กรุณาเพิ่มเครื่องพิมพ์หรือเลือกเครื่องใหม่");
      if(Virtual(name))throw new InvalidOperationException("เครื่องพิมพ์ไฟล์ PDF/Fax ไม่รองรับการพิมพ์อัตโนมัติ กรุณาเลือกเครื่องพิมพ์จริง");
      if(Offline(name))throw new InvalidOperationException("เครื่องพิมพ์ "+name+" ออฟไลน์ กรุณาเปิดเครื่องและตรวจการเชื่อมต่อ");
    }
    public static object List(){
      return PrinterSettings.InstalledPrinters.Cast<string>().Select(name=>new{name=name,offline=Offline(name),isVirtual=Virtual(name)}).ToArray();
    }
  }
  class PrintHost:Form {
    readonly string root;readonly int port;readonly string exportFolder;
    Bridge bridge;WebView2 view;Task ready;NotifyIcon tray;
    string document;
    public PrintHost(string folder,int listenPort,string exports=null){
      root=folder;port=listenPort;exportFolder=exports;
      Text="SAPURI Print";ShowInTaskbar=false;Opacity=0;FormBorderStyle=FormBorderStyle.None;
      StartPosition=FormStartPosition.Manual;Location=new Point(-30000,-30000);Size=new Size(1000,1200);
    }
    protected override void OnLoad(EventArgs e){
      base.OnLoad(e);
      Func<object> list=Printers.List;Action<string> validate=Printers.Validate;
#if PRINT_TESTING
      if(exportFolder!=null){list=()=>new[]{new{name="Test Receipt",offline=false,isVirtual=false},new{name="Test A4",offline=false,isVirtual=false},new{name="Test Barcode",offline=false,isVirtual=false}};validate=name=>{if(!new[]{"Test Receipt","Test A4","Test Barcode"}.Contains(name))throw new InvalidOperationException("Unknown test printer");};}
#endif
      bridge=new Bridge(root,port,Dispatch,list,validate);bridge.Start();
      if(exportFolder==null){
        var menu=new ContextMenuStrip();menu.Items.Add("ปิดตัวช่วยพิมพ์",null,(s,a)=>Close());
        tray=new NotifyIcon{Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath),Text="SAPURI — พิมพ์ใบเสร็จ A4 และบาร์โค้ด",ContextMenuStrip=menu,Visible=true};
      }
    }
    protected override void OnFormClosed(FormClosedEventArgs e){if(bridge!=null)bridge.Stop();if(tray!=null){tray.Visible=false;tray.Dispose();}if(view!=null)view.Dispose();base.OnFormClosed(e);}
    Task Dispatch(PrintRequest request,string printer){
      var completion=new TaskCompletionSource<bool>();
      BeginInvoke(new Action(async()=>{try{await Print(request,printer);completion.SetResult(true);}catch(Exception ex){completion.SetException(ex);}}));
      return completion.Task;
    }
    async Task EnsureRenderer(){
      if(ready!=null){await ready;return;}
      ready=Initialize();try{await ready;}catch{ready=null;if(view!=null){Controls.Remove(view);view.Dispose();view=null;}throw new InvalidOperationException("เปิดระบบพิมพ์ไม่ได้ กรุณาตรวจ Microsoft Edge WebView2 Runtime และเปิดตัวช่วยใหม่");}
    }
    async Task Initialize(){
      view=new WebView2{Dock=DockStyle.Fill};Controls.Add(view);
      var environment=await CoreWebView2Environment.CreateAsync(null,Path.Combine(root,"Renderer"));
      await view.EnsureCoreWebView2Async(environment);var core=view.CoreWebView2;
      core.Settings.IsScriptEnabled=false;core.Settings.IsWebMessageEnabled=false;core.Settings.AreHostObjectsAllowed=false;
      core.Settings.AreDevToolsEnabled=false;core.Settings.AreDefaultContextMenusEnabled=false;core.Settings.AreDefaultScriptDialogsEnabled=false;
      core.PermissionRequested+=(s,a)=>{a.State=CoreWebView2PermissionState.Deny;};
      core.NewWindowRequested+=(s,a)=>{a.Handled=true;};core.DownloadStarting+=(s,a)=>{a.Cancel=true;};
      core.NavigationStarting+=(s,a)=>{if(a.Uri!="https://sapuri-print.invalid/document")a.Cancel=true;};
      core.AddWebResourceRequestedFilter("*",CoreWebView2WebResourceContext.All);
      core.WebResourceRequested+=(s,a)=>{
        bool allowed=a.Request.Uri=="https://sapuri-print.invalid/document"&&a.Request.Method=="GET"&&a.ResourceContext==CoreWebView2WebResourceContext.Document;
        byte[] bytes=Encoding.UTF8.GetBytes(allowed?document??"":"");
        a.Response=environment.CreateWebResourceResponse(new MemoryStream(bytes),allowed?200:403,allowed?"OK":"Blocked","Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; script-src 'none'; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'");
      };
    }
    static string FontCss(){
      string folder=Path.GetDirectoryName(Application.ExecutablePath);
      var entries=new[]{new[]{"Sarabun","400","Sarabun-Regular.ttf"},new[]{"Sarabun","600","Sarabun-SemiBold.ttf"},new[]{"Sarabun","700","Sarabun-Bold.ttf"},new[]{"Noto Sans Thai","100 900","NotoSansThai.ttf"}};
      return "<style>"+String.Join("",entries.Select(f=>"@font-face{font-family:'"+f[0]+"';font-style:normal;font-weight:"+f[1]+";src:url(data:font/ttf;base64,"+Convert.ToBase64String(File.ReadAllBytes(Path.Combine(folder,f[2])))+") format('truetype')}"))+"</style>";
    }
    async Task Print(PrintRequest request,string printer){
      await EnsureRenderer();var core=view.CoreWebView2;
      document=Regex.Replace(request.html,@"</head\s*>",FontCss()+"</head>",RegexOptions.IgnoreCase);
      var loaded=new TaskCompletionSource<bool>();
      EventHandler<CoreWebView2NavigationCompletedEventArgs> onLoaded=(s,a)=>{if(a.IsSuccess)loaded.TrySetResult(true);else loaded.TrySetException(new InvalidOperationException("โหลดเอกสารพิมพ์ไม่สำเร็จ"));};
      core.NavigationCompleted+=onLoaded;
      try{
        core.Navigate("https://sapuri-print.invalid/document");
        if(await Task.WhenAny(loaded.Task,Task.Delay(20000))!=loaded.Task)throw new InvalidOperationException("เตรียมเอกสารนานเกินไป ยังไม่ได้ส่งงานพิมพ์");
        await loaded.Task;
      }finally{core.NavigationCompleted-=onLoaded;document=null;}
      await core.CallDevToolsProtocolMethodAsync("Emulation.setEmulatedMedia","{\"media\":\"print\"}");
      // Only these fixed application scripts run. Scripts in supplied HTML are disabled.
      await core.ExecuteScriptAsync("document.fonts.ready.then(()=>{window.__sapuriFontsReady=true})");
      for(int i=0;i<100;i++){if(await core.ExecuteScriptAsync("window.__sapuriFontsReady===true")=="true")break;if(i==99)throw new InvalidOperationException("โหลดตัวอักษรไม่สำเร็จ ยังไม่ได้ส่งงานพิมพ์");await Task.Delay(50);}
      var settings=core.Environment.CreatePrintSettings();
      settings.PrinterName=printer;settings.Copies=1;settings.ShouldPrintBackgrounds=true;settings.ShouldPrintHeaderAndFooter=false;
      settings.MarginTop=settings.MarginBottom=settings.MarginLeft=settings.MarginRight=0;
      settings.ScaleFactor=1;settings.MediaSize=CoreWebView2PrintMediaSize.Custom;
      settings.PageWidth=request.width/25.4;settings.PageHeight=request.height/25.4;
      if(request.kind=="receipt"){
        double height=Data.Read<double>(await core.ExecuteScriptAsync("Math.ceil(document.querySelector('.receipt').getBoundingClientRect().height*25.4/96)+1"));
        if(height<20||height>3000)throw new InvalidOperationException("ใบเสร็จยาวเกินขนาดที่รองรับ กรุณาแบ่งรายการพิมพ์");
        settings.PageHeight=height/25.4;
      }
      settings.Orientation=CoreWebView2PrintOrientation.Portrait;
#if PRINT_TESTING
      if(exportFolder!=null){
        Directory.CreateDirectory(exportFolder);
        if(!await core.PrintToPdfAsync(Path.Combine(exportFolder,request.id+".pdf"),settings))throw new Exception("PDF rendering failed");
        Data.Save(Path.Combine(exportFolder,request.id+".json"),new{printer=printer,kind=request.kind,width=request.width,height=request.height});return;
      }
#endif
      Printers.Validate(printer);
      CoreWebView2PrintStatus result=await core.PrintAsync(settings);
      if(result!=CoreWebView2PrintStatus.Succeeded)throw new InvalidOperationException(result==CoreWebView2PrintStatus.PrinterUnavailable?"เครื่องพิมพ์ไม่พร้อมใช้งาน กรุณาตรวจไดรเวอร์และขนาดกระดาษ":"Windows ส่งงานพิมพ์ไม่สำเร็จ");
    }
  }
}
