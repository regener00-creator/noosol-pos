using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Printing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Management;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace SapuriSetup {
  static class Program {
    [STAThread] static void Main(string[] args) {
      Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
      try {
#if SETUP_TESTING
        if(args.Length==2 && args[0]=="--self-test") { Tests.Run(args[1]); return; }
        if(args.Length==2 && args[0]=="--test-folder") {
          var root=Path.GetFullPath(args[1]); Directory.CreateDirectory(root);Directory.CreateDirectory(Path.Combine(root,"Desktop"));
          Application.Run(new SetupForm(new Engine(Path.Combine(root,"Install"),Path.Combine(root,"Desktop")),true)); return;
        }
#endif
        Application.Run(new SetupForm(new Engine(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"SAPURI POS"),Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),"SAPURI POS","Assets"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),@"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar")),false));
      } catch(Exception ex) { MessageBox.Show("เปิดชุดตั้งค่าไม่ได้\n"+ex.Message,"SAPURI POS",MessageBoxButtons.OK,MessageBoxIcon.Error); }
    }
  }
  class PaperChoice {
    public string Name; public int Width,Height,RawKind;
    public override string ToString(){return Name+"  ("+(Width*0.254).ToString("0.#")+" × "+(Height*0.254).ToString("0.#")+" มม. ตามไดรเวอร์)";}
    public bool Fits(int width){double mm=Width*0.254; return width==58 ? mm>=44 && mm<=60 : mm>60 && mm<=85;}
  }
  class Plan {
    public string Printer,Chrome,Id; public int Width; public PaperChoice Paper;
  }
  class Engine {
    public const string Site="https://pepo-pharmacy.vercel.app/";
    public readonly string Root,Desktop,Assets,Pinned;
    public string IconPath {get{return Path.Combine(Assets,"sapuri-v2.ico");}}
    public string Profile {get{return Path.Combine(Root,"Chrome");}}
    public string Shortcut {get{return Path.Combine(Desktop,"SAPURI POS.lnk");}}
    public string LogPath {get{return Path.Combine(Root,"setup.log");}}
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer{MaxJsonLength=32*1024*1024};
    public Engine(string root,string desktop,string assets=null,string pinned=null){Root=Path.GetFullPath(root);Desktop=desktop;Assets=assets??Path.Combine(Root,"Assets");Pinned=pinned;}
    public static Dictionary<string,object> Obj(params object[] pairs){var d=new Dictionary<string,object>();for(int i=0;i<pairs.Length;i+=2)d[(string)pairs[i]]=pairs[i+1];return d;}
    public static string Serialize(object v){return Json.Serialize(v);}
    public static Dictionary<string,object> Parse(string text){return Json.Deserialize<Dictionary<string,object>>(text);}
    public static Dictionary<string,object> Child(Dictionary<string,object> d,string key){object v; if(d.TryGetValue(key,out v)&&v is Dictionary<string,object>)return (Dictionary<string,object>)v;var n=Obj();d[key]=n;return n;}
    public void Log(string text){try{Directory.CreateDirectory(Root);File.AppendAllText(LogPath,DateTime.Now.ToString("s")+" "+text+Environment.NewLine,new UTF8Encoding(false));}catch{}}
    public static string FindChrome(){
      var candidates=new List<string>();
      foreach(var hive in new[]{Registry.CurrentUser,Registry.LocalMachine}) foreach(var branch in new[]{@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",@"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"}) {
        using(var k=hive.OpenSubKey(branch)){if(k!=null)candidates.Add(Convert.ToString(k.GetValue("")));}
      }
      candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),@"Google\Chrome\Application\chrome.exe"));
      candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),@"Google\Chrome\Application\chrome.exe"));
      candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),@"Google\Chrome\Application\chrome.exe"));
      var result=candidates.FirstOrDefault(p=>!String.IsNullOrWhiteSpace(p)&&File.Exists(p));
      if(result==null)throw new InvalidOperationException("ไม่พบ Google Chrome — ติดตั้ง Chrome จาก google.com/chrome แล้วกดตรวจสอบอีกครั้ง");return result;
    }
    public static List<string> Printers(){return PrinterSettings.InstalledPrinters.Cast<string>().OrderBy(s=>s).ToList();}
    public static List<PaperChoice> Papers(string printer){
      var s=new PrinterSettings{PrinterName=printer};if(!s.IsValid)throw new InvalidOperationException("Windows ไม่พบเครื่องพิมพ์นี้แล้ว — เพิ่มเครื่องพิมพ์ใน Windows แล้วกดตรวจสอบอีกครั้ง");
      return s.PaperSizes.Cast<PaperSize>().Where(p=>p.Width>0&&p.Height>0).Select(p=>new PaperChoice{Name=p.PaperName,Width=p.Width,Height=p.Height,RawKind=p.RawKind}).ToList();
    }
    public static void ValidatePrinter(Plan p){
      if(String.IsNullOrWhiteSpace(p.Printer))throw new InvalidOperationException("กรุณาเลือกเครื่องพิมพ์ใบเสร็จ");
      if(p.Printer.IndexOf("PDF",StringComparison.OrdinalIgnoreCase)>=0||p.Printer.IndexOf("XPS",StringComparison.OrdinalIgnoreCase)>=0||p.Printer.Equals("Fax",StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("เครื่องที่เลือกเป็นเครื่องพิมพ์ไฟล์หรือ Fax — กรุณาเลือกเครื่องพิมพ์ใบเสร็จจริง");
      if(p.Paper==null||!p.Paper.Fits(p.Width))throw new InvalidOperationException("ขนาดกระดาษในไดรเวอร์ไม่ตรงกับใบเสร็จ — เลือก 58/80 มม. ให้ตรงกัน หรือติดตั้งไดรเวอร์ของผู้ผลิตก่อน");
      if(!Papers(p.Printer).Any(x=>x.RawKind==p.Paper.RawKind&&x.Width==p.Paper.Width&&x.Height==p.Paper.Height))throw new InvalidOperationException("รายการกระดาษของเครื่องพิมพ์เปลี่ยนแล้ว — กดตรวจสอบอีกครั้ง");
      using(var search=new ManagementObjectSearcher("SELECT Name,WorkOffline,PrinterStatus FROM Win32_Printer")) foreach(ManagementObject printer in search.Get()) {
        if(Convert.ToString(printer["Name"])!=p.Printer)continue;
        if(Convert.ToBoolean(printer["WorkOffline"])||Convert.ToInt32(printer["PrinterStatus"])==7)throw new InvalidOperationException("Windows แจ้งว่าเครื่องพิมพ์ออฟไลน์ — เปิดเครื่อง ตรวจสาย USB/Wi-Fi และยกเลิก Use Printer Offline ในคิวพิมพ์ แล้วกดลองใหม่");
      }
    }
    public bool ProfileRunning(){
      // Fail closed if process inspection is denied: never edit a live Chrome profile.
      using(var search=new ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE Name='chrome.exe'")) foreach(ManagementObject process in search.Get()) {
        string cmd=Convert.ToString(process["CommandLine"]);
        if(cmd.IndexOf("--user-data-dir",StringComparison.OrdinalIgnoreCase)>=0&&cmd.IndexOf(Profile,StringComparison.OrdinalIgnoreCase)>=0)return true;
      }
      return false;
    }
    public static string Quote(string value){if(value.Contains("\"")||value.Contains("\r")||value.Contains("\n"))throw new InvalidOperationException("เส้นทางมีอักขระที่ไม่รองรับ");return "\""+value+"\"";}
    public string Args(string url){return "--user-data-dir="+Quote(Profile)+" --profile-directory=\"Default\" --kiosk-printing --no-first-run --no-default-browser-check --app="+Quote(url);}
    public static string Url(Plan p){return Site+"?sapuriPaper="+p.Width+"&sapuriSetup="+p.Id;}
    public void CheckShortcut(){
      if(String.IsNullOrWhiteSpace(Desktop)||!Directory.Exists(Desktop))throw new InvalidOperationException("ไม่พบโฟลเดอร์เดสก์ท็อป — เปิด Desktop/OneDrive ให้พร้อมแล้วลองใหม่");
      if(!File.Exists(Shortcut))return;
      dynamic shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));dynamic old=shell.CreateShortcut(Shortcut);
      string args=Convert.ToString(old.Arguments);
      if(args.IndexOf(Profile,StringComparison.OrdinalIgnoreCase)<0||args.IndexOf(Site,StringComparison.OrdinalIgnoreCase)<0)throw new InvalidOperationException("มีไอคอน SAPURI POS ของโปรแกรมอื่นอยู่แล้ว — เปลี่ยนชื่อไอคอนเดิมก่อน ชุดตั้งค่าจะไม่เขียนทับ");
    }
    public static Dictionary<string,object> BuildPrefs(Dictionary<string,object> prefs,Plan p){
      var media=Obj("custom_display_name",p.Paper.Name,"width_microns",p.Paper.Width*254,"height_microns",p.Paper.Height*254,"vendor_id",p.Paper.RawKind.ToString(CultureInfo.InvariantCulture));
      var state=Obj("version",2,"recentDestinations",new object[]{Obj("id",p.Printer,"origin","local","displayName",p.Printer)},"mediaSize",media,"isHeaderFooterEnabled",false,"isLandscapeEnabled",false,"isColorEnabled",false);
      Child(Child(prefs,"printing"),"print_preview_sticky_settings")["appState"]=Serialize(state);
      Child(prefs,"browser")["check_default_browser"]=false;
      Child(prefs,"profile")["name"]="SAPURI POS";
      return prefs;
    }
    public static void AtomicSave(string path,string text){
      Directory.CreateDirectory(Path.GetDirectoryName(path));string temp=path+".setup-"+Guid.NewGuid().ToString("N");
      File.WriteAllText(temp,text,new UTF8Encoding(false));
      try{if(File.Exists(path))File.Replace(temp,path,path+".backup-"+DateTime.UtcNow.ToString("yyyyMMddHHmmssfff"));else File.Move(temp,path);}finally{if(File.Exists(temp))File.Delete(temp);}
    }
    public void SaveProfile(Plan p){
      if(ProfileRunning())throw new InvalidOperationException("SAPURI POS ยังเปิดอยู่ — ปิดหน้าหลักและหน้าต่างใบเสร็จของ SAPURI ให้หมด แล้วกดลองใหม่ ไม่จำเป็นต้องปิด Chrome ปกติ");
      CheckShortcut();Directory.CreateDirectory(Root);
      using(var guard=new FileStream(Path.Combine(Root,"setup.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None)){
        string file=Path.Combine(Profile,"Default","Preferences");
        Dictionary<string,object> prefs;
        try{prefs=File.Exists(file)?Parse(File.ReadAllText(file)):Obj();if(prefs==null)throw new Exception();}
        catch{throw new InvalidOperationException("อ่านการตั้งค่า Chrome เดิมไม่ได้ — ไม่ได้เขียนทับข้อมูล กรุณาส่งบันทึกปัญหาให้ผู้ดูแล");}
        AtomicSave(file,Serialize(BuildPrefs(prefs,p)));
        var check=Parse(File.ReadAllText(file));var state=Parse(Convert.ToString(Child(Child(check,"printing"),"print_preview_sticky_settings")["appState"]));
        var savedDestination=(Dictionary<string,object>)((IList)state["recentDestinations"])[0];
        if(Convert.ToString(savedDestination["id"])!=p.Printer)throw new InvalidOperationException("ตรวจสอบค่าที่บันทึกไม่ผ่าน กรุณาลองใหม่");
        AtomicSave(Path.Combine(Root,"setup-settings.json"),Serialize(Obj("printer",p.Printer,"paperWidth",p.Width,"paperName",p.Paper.Name,"chrome",p.Chrome,"setupId",p.Id)));
      }
    }
    public void SaveShortcut(Plan p){
      CheckShortcut();Directory.CreateDirectory(Assets);string icon=IconPath;
      using(var input=Assembly.GetExecutingAssembly().GetManifestResourceStream("sapuri.ico"))using(var output=File.Create(icon)){input.CopyTo(output);}
      if(File.Exists(Shortcut))File.Copy(Shortcut,Path.Combine(Root,"shortcut-backup-"+DateTime.UtcNow.ToString("yyyyMMddHHmmssfff")+".lnk"));
      dynamic shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));dynamic link=shell.CreateShortcut(Shortcut);
      link.TargetPath=p.Chrome;link.Arguments=Args(Url(p));link.WorkingDirectory=Root;link.IconLocation=icon+",0";link.Description="SAPURI POS — พิมพ์ใบเสร็จอัตโนมัติ";link.Save();
      ShellIdentity.Apply(Shortcut,Quote(p.Chrome)+" "+Args(Url(p)),icon+",0");
      dynamic read=shell.CreateShortcut(Shortcut);if((string)read.TargetPath!=p.Chrome||(string)read.Arguments!=Args(Url(p)))throw new InvalidOperationException("ตรวจสอบไอคอนไม่ผ่าน — ตรวจสิทธิ์ Desktop/OneDrive แล้วกดลองใหม่");
      // Repair only existing SAPURI pins that use this exact profile and site.
      // Pinning a new app remains a user action; never change ordinary Chrome pins.
      if(!String.IsNullOrEmpty(Pinned)&&Directory.Exists(Pinned))foreach(string path in Directory.GetFiles(Pinned,"*.lnk")){
        dynamic pin=shell.CreateShortcut(path);string args=Convert.ToString(pin.Arguments);
        if(!String.Equals(Convert.ToString(pin.TargetPath),p.Chrome,StringComparison.OrdinalIgnoreCase)||args.IndexOf(Quote(Profile),StringComparison.OrdinalIgnoreCase)<0||args.IndexOf(Site,StringComparison.OrdinalIgnoreCase)<0)continue;
        File.Copy(path,Path.Combine(Root,"pin-backup-"+Guid.NewGuid().ToString("N")+".lnk"));
        pin.Arguments=Args(Url(p));pin.IconLocation=icon+",0";pin.Description="SAPURI POS — พิมพ์ใบเสร็จอัตโนมัติ";pin.Save();
        ShellIdentity.Apply(path,Quote(p.Chrome)+" "+Args(Url(p)),icon+",0");
      }
    }
    public void Launch(Plan p,string url){Process.Start(new ProcessStartInfo(p.Chrome,Args(url)){UseShellExecute=true,WindowStyle=ProcessWindowStyle.Normal});}
    public async Task TestPrint(Plan p){
      ValidatePrinter(p);
      string token=Guid.NewGuid().ToString("N");var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();
      string url="http://127.0.0.1:"+((IPEndPoint)listener.LocalEndpoint).Port+"/"+token+"/test";
      string label=WebUtility.HtmlEncode(p.Printer),paper=WebUtility.HtmlEncode(p.Paper.Name);
      string html="<!doctype html><html lang='th'><meta charset='utf-8'><title>SAPURI SETUP TEST</title><style>@page{size:auto;margin:0}body{margin:0;color:#000;font:600 12px Tahoma,sans-serif}.receipt{box-sizing:border-box;width:"+p.Width+"mm;padding:5mm 6mm}h1{font-size:18px}p{line-height:1.7;overflow-wrap:anywhere}</style><div class='receipt'><h1>SAPURI POS</h1><p>ทดสอบพิมพ์อัตโนมัติ<br>ไม่ใช่ใบเสร็จขาย</p><p>เครื่องพิมพ์: "+label+"<br>กระดาษ: "+paper+"</p><p>ภาษาไทย / English<br>0123456789<br>ทดสอบตัวอักษรเล็กใต้สินค้า</p><hr><p>ไม่บันทึกยอดขายหรือตัดสต๊อก</p></div><script>addEventListener('afterprint',()=>{fetch('/"+token+"/done',{method:'POST',keepalive:true}).finally(()=>window.close())},{once:true});addEventListener('load',()=>setTimeout(()=>window.print(),500));</script></html>";
      DateTime end=DateTime.UtcNow.AddSeconds(45);bool served=false;
      try{
        Launch(p,url);
        while(DateTime.UtcNow<end){
          var accept=listener.AcceptTcpClientAsync();var limit=Task.Delay((int)Math.Max(1,(end-DateTime.UtcNow).TotalMilliseconds));
          if(await Task.WhenAny(accept,limit)!=accept)break;
          using(var client=await accept){
            client.ReceiveTimeout=2000;client.SendTimeout=2000;
            using(var stream=client.GetStream())using(var reader=new StreamReader(stream,Encoding.ASCII,false,1024,true)){
              string line=reader.ReadLine()??"";string header;int count=0;while(!String.IsNullOrEmpty(header=reader.ReadLine())){if(++count>80)throw new IOException("คำขอทดสอบไม่ถูกต้อง");}
              bool test=line=="GET /"+token+"/test HTTP/1.1";bool done=served&&line=="POST /"+token+"/done HTTP/1.1";
              byte[] body=Encoding.UTF8.GetBytes(test?html:done?"ok":"not found");
              byte[] head=Encoding.ASCII.GetBytes("HTTP/1.1 "+(test||done?"200 OK":"404 Not Found")+"\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: "+body.Length+"\r\n\r\n");
              stream.Write(head,0,head.Length);stream.Write(body,0,body.Length);stream.Flush();
              if(done)return;if(test)served=true;
            }
          }
        }
        throw new InvalidOperationException("ยังไม่ได้รับผลจาก Chrome ภายใน 45 วินาที — ตรวจหน้าต่าง Chrome และคิวเครื่องพิมพ์ก่อนกดลองใหม่ เพื่อหลีกเลี่ยงพิมพ์ซ้ำ");
      }finally{listener.Stop();}
    }
  }
  class SetupForm:Form {
    readonly Engine engine; readonly bool testing; ComboBox printers=new ComboBox(),widths=new ComboBox(),papers=new ComboBox();
    Button scan=new Button(),setup=new Button(),test=new Button(),yes=new Button(),no=new Button(),open=new Button(),logs=new Button();
    ListView steps=new ListView();TextBox detail=new TextBox(); Label stateLabel=new Label(); bool busy,configured;int failed=-1;Plan current;
    readonly string[] names={"ตรวจ Google Chrome","ตรวจเครื่องพิมพ์และกระดาษ","ตั้งค่า Chrome สำหรับ SAPURI","สร้างและตรวจไอคอนบนเดสก์ท็อป","ส่งใบทดสอบจาก Chrome","ยืนยันกระดาษที่พิมพ์จริง"};
    public SetupForm(Engine e,bool testMode){
      engine=e;testing=testMode;Text="SAPURI POS — ตั้งค่าพิมพ์อัตโนมัติ"+(testing?" [ทดสอบ]":"");
      // Windows bitmap scaling keeps this small .NET Framework utility usable at high display scales.
      AutoScaleMode=AutoScaleMode.None;
      Font=new Font("Tahoma",10);Size=new Size(900,810);MinimumSize=new Size(760,720);StartPosition=FormStartPosition.CenterScreen;
      try{using(var s=Assembly.GetExecutingAssembly().GetManifestResourceStream("sapuri.ico"))Icon=new Icon(s);}catch{}
      var panel=new TableLayoutPanel{Dock=DockStyle.Fill,Padding=new Padding(22),ColumnCount=1,RowCount=8};
      panel.RowStyles.Add(new RowStyle(SizeType.Absolute,64));panel.RowStyles.Add(new RowStyle(SizeType.Absolute,144));panel.RowStyles.Add(new RowStyle(SizeType.Absolute,48));panel.RowStyles.Add(new RowStyle(SizeType.Percent,100));panel.RowStyles.Add(new RowStyle(SizeType.Absolute,32));panel.RowStyles.Add(new RowStyle(SizeType.Absolute,105));panel.RowStyles.Add(new RowStyle(SizeType.Absolute,48));panel.RowStyles.Add(new RowStyle(SizeType.Absolute,48));Controls.Add(panel);
      panel.Controls.Add(new Label{Text="SAPURI POS  |  พิมพ์ใบเสร็จในคลิกเดียว\nสำหรับ Windows 10/11 • ติดตั้ง Chrome และไดรเวอร์เครื่องพิมพ์ให้พร้อมก่อน",Dock=DockStyle.Fill,Font=new Font("Tahoma",11),AutoSize=false},0,0);
      var fields=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2,RowCount=3};fields.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,160));fields.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      foreach(var c in new[]{printers,widths,papers}){c.DropDownStyle=ComboBoxStyle.DropDownList;c.Dock=DockStyle.Fill;c.Margin=new Padding(3,7,3,7);}
      string[] labels={"เครื่องพิมพ์","ความกว้างใบเสร็จ","กระดาษในไดรเวอร์"};Control[] combos={printers,widths,papers};for(int i=0;i<3;i++){fields.RowStyles.Add(new RowStyle(SizeType.Percent,33.33f));fields.Controls.Add(new Label{Text=labels[i],AutoSize=true,Margin=new Padding(0,11,0,0)},0,i);fields.Controls.Add(combos[i],1,i);}panel.Controls.Add(fields,0,1);
      widths.Items.AddRange(new object[]{"80 มม.","58 มม."});widths.SelectedIndex=0;
      var actions=new FlowLayoutPanel{Dock=DockStyle.Fill};Configure(scan,"ตรวจสอบ / โหลดรายชื่อใหม่",230);Configure(setup,"ตั้งค่าและพิมพ์ทดสอบ",240);actions.Controls.AddRange(new Control[]{scan,setup});panel.Controls.Add(actions,0,2);
      steps.Dock=DockStyle.Fill;steps.View=View.Details;steps.FullRowSelect=true;steps.GridLines=true;steps.HeaderStyle=ColumnHeaderStyle.Nonclickable;steps.Columns.Add("ขั้นตอน",310);steps.Columns.Add("สถานะ",430);
      foreach(string n in names){var row=new ListViewItem(n);row.SubItems.Add("รอดำเนินการ");steps.Items.Add(row);}panel.Controls.Add(steps,0,3);
      stateLabel.Dock=DockStyle.Fill;stateLabel.Text="เลือกเครื่องพิมพ์และกระดาษ แล้วกดตั้งค่า";panel.Controls.Add(stateLabel,0,4);
      detail.Multiline=true;detail.ReadOnly=true;detail.ScrollBars=ScrollBars.Vertical;detail.Dock=DockStyle.Fill;detail.BackColor=Color.White;detail.Text="ข้อมูลและวิธีแก้ปัญหาจะแสดงที่นี่\r\nงาน A4 หรือบันทึก PDF ให้เปิดจาก Chrome ปกติ";panel.Controls.Add(detail,0,5);
      var confirm=new FlowLayoutPanel{Dock=DockStyle.Fill};Configure(test,"พิมพ์ทดสอบ / ลองใหม่",220);Configure(yes,"กระดาษออกถูกต้อง",190);Configure(no,"ไม่ออก / ไม่ถูกต้อง",190);confirm.Controls.AddRange(new Control[]{test,yes,no});panel.Controls.Add(confirm,0,6);
      var bottom=new FlowLayoutPanel{Dock=DockStyle.Fill};Configure(open,"เปิด SAPURI POS",200);Configure(logs,"บันทึกปัญหา…",160);bottom.Controls.AddRange(new Control[]{open,logs});panel.Controls.Add(bottom,0,7);
      test.Enabled=yes.Enabled=no.Enabled=open.Enabled=false;
      printers.SelectedIndexChanged+=(s,a)=>{if(!busy){configured=false;LoadPapers();RefreshButtons();}};
      widths.SelectedIndexChanged+=(s,a)=>{if(!busy){configured=false;LoadPapers();RefreshButtons();}};
      papers.SelectedIndexChanged+=(s,a)=>{if(!busy){configured=false;RefreshButtons();}};
      scan.Click+=async(s,a)=>await Inspect();setup.Click+=async(s,a)=>await Install();test.Click+=async(s,a)=>await PrintTest();
      yes.Click+=(s,a)=>{Status(5,"สำเร็จ — ผู้ใช้ยืนยันกระดาษแล้ว",Color.DarkGreen);stateLabel.Text="พร้อมใช้งาน — เปิด SAPURI POS และเข้าสู่ระบบครั้งแรก";engine.Log("User confirmed physical test print.");};
      no.Click+=(s,a)=>{Status(5,"ต้องตรวจสอบ — กระดาษไม่ถูกต้อง",Color.Firebrick);detail.Text="ตรวจว่าเครื่องเปิดและมีกระดาษ\r\nตรวจคิวพิมพ์ Windows ว่าติดออฟไลน์หรือมีงานค้าง\r\nถ้าขนาดไม่ตรง ให้ปิด SAPURI POS แล้วเลือกกระดาษใหม่และกดตั้งค่า\r\nเมื่อแก้แล้วกดพิมพ์ทดสอบ / ลองใหม่ (จะส่งอีกหนึ่งใบ)";engine.Log("User reported physical test print problem.");};
      open.Click+=(s,a)=>{try{engine.Launch(current,Engine.Url(current));}catch(Exception ex){ShowFailure(3,ex);}};
      logs.Click+=(s,a)=>{using(var save=new SaveFileDialog{Filter="Text log|*.txt",FileName="SAPURI-setup-log.txt"})if(save.ShowDialog()==DialogResult.OK){try{File.Copy(engine.LogPath,save.FileName,true);}catch(Exception ex){MessageBox.Show(ex.Message);}}};
      FormClosing+=(s,a)=>{if(busy){a.Cancel=true;stateLabel.Text="กรุณารอขั้นตอนปัจจุบันจบก่อนปิดโปรแกรม";}};
      Shown+=async(s,a)=>await Inspect();
    }
    static void Configure(Button b,string text,int width){b.Text=text;b.Width=width;b.Height=36;b.Margin=new Padding(0,3,9,3);}
    void RefreshButtons(){scan.Enabled=setup.Enabled=printers.Enabled=widths.Enabled=papers.Enabled=!busy;test.Enabled=open.Enabled=!busy&&configured;yes.Enabled=no.Enabled=!busy&&configured&&failed!=4;}
    void Status(int step,string message,Color color){if(InvokeRequired){Invoke(new Action(()=>Status(step,message,color)));return;}steps.Items[step].SubItems[1].Text=message;steps.Items[step].ForeColor=color;engine.Log(names[step]+": "+message);}
    void ShowFailure(int step,Exception ex){failed=step;Status(step,"ติดขัด — ดูวิธีแก้ด้านล่าง",Color.Firebrick);detail.Text=ex.Message;
      if(ex is UnauthorizedAccessException || ex is ManagementException)detail.Text="Windows ไม่อนุญาตให้อ่านหรือบันทึกค่าที่ขั้นตอนนี้ — ใช้บัญชี Windows ที่จะขายสินค้า และให้ผู้ดูแลตรวจสิทธิ์เครื่องพิมพ์/โฟลเดอร์ จากนั้นกดลองใหม่\r\nรายละเอียด: "+ex.Message;
      else if(ex is IOException)detail.Text="ไฟล์หรือบริการกำลังถูกใช้งาน หรือพื้นที่ไม่พอ — ปิดชุดตั้งค่าหน้าต่างอื่น ตรวจพื้นที่ว่างและสิทธิ์โฟลเดอร์ แล้วกดลองใหม่\r\nรายละเอียด: "+ex.Message;
      stateLabel.Text="ติดขัดที่: "+names[step];setup.Text="ลองตั้งค่าอีกครั้ง";engine.Log(ex.ToString());}
    void LoadPapers(){try{papers.Items.Clear();if(printers.SelectedItem==null)return;int width=widths.SelectedIndex==1?58:80;var list=Engine.Papers((string)printers.SelectedItem).Where(p=>p.Fits(width)).OrderBy(p=>Math.Abs(p.Height*0.254-210)).ToList();papers.Items.AddRange(list.Cast<object>().ToArray());if(papers.Items.Count>0)papers.SelectedIndex=0;else detail.Text="ไดรเวอร์นี้ไม่มีกระดาษที่ตรงกับความกว้างที่เลือก — ลองเปลี่ยน 58/80 มม. หรือติดตั้งไดรเวอร์จากผู้ผลิต";}catch(Exception ex){ShowFailure(1,ex);}}
    async Task Inspect(){
      busy=true;configured=false;RefreshButtons();int stage=0;try{
        string chrome=await Task.Run(()=>Engine.FindChrome());Status(0,"พบ Chrome",Color.DarkGreen);
        stage=1;
        var list=await Task.Run(()=>Engine.Printers());string previous=Convert.ToString(printers.SelectedItem);printers.Items.Clear();printers.Items.AddRange(list.Cast<object>().ToArray());
        if(list.Count==0)throw new InvalidOperationException("ไม่พบเครื่องพิมพ์ใน Windows — ติดตั้งไดรเวอร์และเพิ่มเครื่องพิมพ์ แล้วกดตรวจสอบอีกครั้ง");
        string pick=list.Contains(previous)?previous:list.FirstOrDefault(n=>n.IndexOf("VOZY",StringComparison.OrdinalIgnoreCase)>=0)??list.FirstOrDefault(n=>n.IndexOf("PDF",StringComparison.OrdinalIgnoreCase)<0&&n.IndexOf("XPS",StringComparison.OrdinalIgnoreCase)<0&&!n.Equals("Fax",StringComparison.OrdinalIgnoreCase))??list[0];printers.SelectedItem=pick;
        LoadPapers();Status(1,"พบ "+list.Count+" เครื่อง — เลือกเครื่องพิมพ์จริง",Color.DarkGreen);
        stateLabel.Text="ตรวจพบ Chrome และรายชื่อเครื่องพิมพ์แล้ว";
      }catch(Exception ex){ShowFailure(stage,ex);}finally{busy=false;RefreshButtons();}
    }
    async Task Install(){
      var plan=new Plan{Printer=Convert.ToString(printers.SelectedItem),Width=widths.SelectedIndex==1?58:80,Paper=papers.SelectedItem as PaperChoice,Id=Guid.NewGuid().ToString("N")};
      busy=true;configured=false;failed=-1;yes.Enabled=no.Enabled=false;RefreshButtons();int step=0;
      try{
        for(int i=0;i<names.Length;i++)Status(i,"รอดำเนินการ",Color.DimGray);
        Status(0,"กำลังตรวจ…",Color.DarkOrange);plan.Chrome=await Task.Run(()=>Engine.FindChrome());Status(0,"พร้อม",Color.DarkGreen);
        step=1;Status(1,"กำลังตรวจ…",Color.DarkOrange);await Task.Run(()=>Engine.ValidatePrinter(plan));Status(1,plan.Printer+" / "+plan.Width+" มม.",Color.DarkGreen);
        step=2;Status(2,"กำลังบันทึก…",Color.DarkOrange);await Task.Run(()=>engine.SaveProfile(plan));Status(2,"บันทึกและตรวจสอบแล้ว",Color.DarkGreen);
        step=3;Status(3,"กำลังสร้าง…",Color.DarkOrange);engine.SaveShortcut(plan);Status(3,"พร้อม — รองรับการปักหมุด Taskbar",Color.DarkGreen);
        current=plan;configured=true;setup.Text="ตั้งค่าอีกครั้ง";detail.Text="ตั้งค่าเสร็จแล้ว กำลังส่งใบทดสอบหนึ่งใบ\r\nเมื่อกระดาษออก ให้ตรวจความชัดและขนาด แล้วกดยืนยัน";
      }catch(Exception ex){ShowFailure(step,ex);}finally{busy=false;RefreshButtons();}
      if(configured)await PrintTest();
    }
    async Task PrintTest(){
      if(!configured||current==null)return;busy=true;failed=-1;RefreshButtons();yes.Enabled=no.Enabled=false;
      Status(4,"กำลังเปิด Chrome และพิมพ์…",Color.DarkOrange);Status(5,"รอผลทดสอบ",Color.DimGray);stateLabel.Text="กำลังส่งใบทดสอบหนึ่งใบ กรุณารอ…";
      try{await Task.Run(()=>engine.TestPrint(current));Status(4,"Chrome จบขั้นตอนพิมพ์แล้ว",Color.DarkGreen);Status(5,"กระดาษออกถูกต้องไหม?",Color.DarkOrange);stateLabel.Text="ตรวจใบที่พิมพ์จริง แล้วกดยืนยันด้านล่าง";detail.Text="Chrome จบขั้นตอนพิมพ์แล้ว แต่ยังยืนยันไม่ได้ว่ากระดาษออกจริง\r\nถ้าใบถูกต้อง กด “กระดาษออกถูกต้อง”\r\nถ้าไม่ออก ให้ตรวจคิวพิมพ์และการเชื่อมต่อก่อนลองใหม่ เพื่อหลีกเลี่ยงพิมพ์ซ้ำ";}
      catch(Exception ex){ShowFailure(4,ex);}finally{busy=false;RefreshButtons();}
    }
  }
}
