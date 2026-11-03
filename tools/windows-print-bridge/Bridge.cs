using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace SapuriPrinting {
  static class Data {
    public static readonly object Gate=new object();
    public static string Json(object value){return new JavaScriptSerializer{MaxJsonLength=12*1024*1024}.Serialize(value);}
    public static T Read<T>(string value){return new JavaScriptSerializer{MaxJsonLength=12*1024*1024}.Deserialize<T>(value);}
    public static void Save(string path,object value){
      Directory.CreateDirectory(Path.GetDirectoryName(path));string temp=path+".new";
      File.WriteAllText(temp,Json(value),new UTF8Encoding(false));
      if(File.Exists(path))File.Replace(temp,path,path+".backup");else File.Move(temp,path);
    }
    public static string Hash(string value){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-","").ToLowerInvariant();}
    public static bool Id(string value){return Regex.IsMatch(value??"",@"\A[a-f0-9]{32}\z");}
    public static bool Kind(string value){return value=="receipt"||value=="a4"||value=="barcode";}
  }
  class Route { public string printer {get;set;} }
  class PrintRequest {
    public string id {get;set;} public string kind {get;set;} public string html {get;set;}
    public double width {get;set;} public double height {get;set;}
  }
  class Job {
    public string id {get;set;} public string kind {get;set;} public string printer {get;set;}
    public string hash {get;set;} public string state {get;set;} public string message {get;set;}
  }
  class Bridge {
    public const int DefaultPort=17839;
    public const string Origin="https://pepo-pharmacy.vercel.app";
    public readonly string Root; public readonly int Port;
    readonly Func<PrintRequest,string,Task> render;
    readonly Func<object> printers;
    readonly Action<string> validatePrinter;
    readonly SemaphoreSlim queue=new SemaphoreSlim(1,1),connections=new SemaphoreSlim(8,8);
    readonly Dictionary<string,Job> jobs;
    TcpListener listener;
    public Bridge(string root,int port,Func<PrintRequest,string,Task> print,Func<object> list,Action<string> validate){
      Root=root;Port=port;render=print;printers=list;validatePrinter=validate;Directory.CreateDirectory(root);
      string journal=Path.Combine(root,"jobs.json");
      jobs=File.Exists(journal)?Data.Read<Dictionary<string,Job>>(File.ReadAllText(journal)):new Dictionary<string,Job>();
      foreach(var job in jobs.Values)if(job.state=="queued"||job.state=="printing"){
        job.state="unknown";job.message="ตัวช่วยเริ่มใหม่ระหว่างส่งงาน กรุณาตรวจคิวและกระดาษก่อนสั่งพิมพ์ใหม่";
      }
      SaveJobs();
    }
    void SaveJobs(){Data.Save(Path.Combine(Root,"jobs.json"),jobs);}
    public Dictionary<string,Route> Settings(){
      string file=Path.Combine(Root,"printers.json");
      return File.Exists(file)?Data.Read<Dictionary<string,Route>>(File.ReadAllText(file)):new Dictionary<string,Route>();
    }
    public object Handle(string path,string body){
      lock(Data.Gate){
        if(path=="/status")return new{version="3.0",protocol=1,settings=Settings()};
        if(path=="/printers")return new{printers=printers(),settings=Settings()};
        if(path=="/settings"){
          var change=Data.Read<Dictionary<string,string>>(body);string kind=change.ContainsKey("kind")?change["kind"]:null;
          string printer=change.ContainsKey("printer")?change["printer"]:null;
          if(!Data.Kind(kind)||String.IsNullOrWhiteSpace(printer))throw new InvalidOperationException("กรุณาเลือกประเภทและเครื่องพิมพ์");
          validatePrinter(printer);var settings=Settings();settings[kind]=new Route{printer=printer};
          Data.Save(Path.Combine(Root,"printers.json"),settings);return new{settings=settings};
        }
        if(path=="/job"){
          var request=Data.Read<PrintRequest>(body);Job job;
          if(!Data.Id(request.id)||!jobs.TryGetValue(request.id,out job))throw new InvalidOperationException("ไม่พบงานพิมพ์นี้ ตรวจคิวเครื่องพิมพ์ก่อนสั่งใหม่");
          return job;
        }
        if(path!="/print")throw new InvalidOperationException("ไม่พบคำสั่งนี้");
        var input=Data.Read<PrintRequest>(body);Validate(input);
        string hash=Data.Hash(input.kind+"\n"+input.width+"\n"+input.height+"\n"+input.html);Job existing;
        if(jobs.TryGetValue(input.id,out existing)){
          if(existing.hash!=hash)throw new InvalidOperationException("รหัสงานซ้ำแต่เนื้อหาเปลี่ยน กรุณาเปิดหน้าพิมพ์ใหม่");
          return existing; // Never reprint after a lost HTTP response or restart.
        }
        if(jobs.Values.Count(x=>x.state=="queued"||x.state=="printing")>=10)throw new InvalidOperationException("มีงานพิมพ์รออยู่หลายงาน กรุณารอให้ส่งงานเสร็จก่อน");
        Route route;var mappings=Settings();
        if(!mappings.TryGetValue(input.kind,out route)||String.IsNullOrWhiteSpace(route.printer))throw new InvalidOperationException("ยังไม่ได้เลือกเครื่องพิมพ์ประเภทนี้ กรุณาไปที่ตั้งค่าการพิมพ์");
        validatePrinter(route.printer);
        if(jobs.Count>=300){foreach(var old in jobs.Values.Where(x=>x.state!="queued"&&x.state!="printing").Take(jobs.Count-299).ToArray())jobs.Remove(old.id);}
        var created=new Job{id=input.id,kind=input.kind,printer=route.printer,hash=hash,state="queued",message="รอส่งงาน"};
        jobs.Add(created.id,created);SaveJobs();
        Task.Run(()=>RunJob(input,created));return created;
      }
    }
    public static void Validate(PrintRequest input){
      if(input==null||!Data.Id(input.id)||!Data.Kind(input.kind))throw new InvalidOperationException("ข้อมูลคำขอพิมพ์ไม่ถูกต้อง");
      if(String.IsNullOrWhiteSpace(input.html)||Encoding.UTF8.GetByteCount(input.html)>8*1024*1024)throw new InvalidOperationException("เอกสารว่างหรือใหญ่เกินไป กรุณาแบ่งรายการพิมพ์");
      if(Double.IsNaN(input.width)||Double.IsInfinity(input.width)||Double.IsNaN(input.height)||Double.IsInfinity(input.height)||input.width<20||input.width>420||input.height<20||input.height>3000)throw new InvalidOperationException("ขนาดกระดาษไม่ถูกต้อง");
      if(input.kind=="a4"&&!(Math.Abs(input.width-210)<0.1&&Math.Abs(input.height-297)<0.1||Math.Abs(input.width-297)<0.1&&Math.Abs(input.height-210)<0.1))throw new InvalidOperationException("เอกสาร A4 ต้องมีขนาด 210 × 297 มม.");
    }
    async Task RunJob(PrintRequest request,Job job){
      await queue.WaitAsync();
      try{
        lock(Data.Gate){job.state="printing";job.message="กำลังส่งไปยัง "+job.printer;SaveJobs();}
        await render(request,job.printer);
        lock(Data.Gate){job.state="sent";job.message="ส่งงานไปยัง "+job.printer+" แล้ว";SaveJobs();}
      }catch(Exception ex){lock(Data.Gate){job.state="failed";job.message=ex.Message+" — ตรวจคิวเครื่องพิมพ์ก่อนสั่งใหม่";SaveJobs();}}
      finally{queue.Release();}
    }
    bool Authorized(string value){
      if(value==null||!Regex.IsMatch(value,@"\ABearer [a-f0-9]{64}\z"))return false;
      string file=Path.Combine(Root,"paired.json");
      lock(Data.Gate){return File.Exists(file)&&Data.Read<List<string>>(File.ReadAllText(file)).Contains(value.Substring(7));}
    }
    public void Start(){listener=new TcpListener(IPAddress.Loopback,Port);listener.Start();Task.Run(()=>Accept());}
    public void Stop(){if(listener!=null)listener.Stop();}
    async Task Accept(){
      while(true){TcpClient client;try{client=await listener.AcceptTcpClientAsync();}catch{return;}
        if(!connections.Wait(0)){client.Close();continue;}
        ThreadPool.QueueUserWorkItem(state=>{try{Serve(client);}catch(Exception ex){try{File.AppendAllText(Path.Combine(Root,"errors.log"),DateTime.Now.ToString("s")+" "+ex.Message+Environment.NewLine);}catch{}}finally{connections.Release();}});
      }
    }
    void Serve(TcpClient client){
      using(client){client.ReceiveTimeout=client.SendTimeout=5000;
        try{using(var stream=client.GetStream()){
          var bytes=new List<byte>();int next;
          while(bytes.Count<16384&&(next=stream.ReadByte())>=0){bytes.Add((byte)next);int n=bytes.Count;if(n>=4&&bytes[n-4]==13&&bytes[n-3]==10&&bytes[n-2]==13&&bytes[n-1]==10)break;}
          string header=Encoding.ASCII.GetString(bytes.ToArray());if(!header.EndsWith("\r\n\r\n"))return;
          var lines=header.Split(new[]{"\r\n"},StringSplitOptions.None);var first=lines[0].Split(' ');
          var headers=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
          foreach(string line in lines.Skip(1)){int colon=line.IndexOf(':');if(colon>0){string key=line.Substring(0,colon);if(headers.ContainsKey(key))return;headers[key]=line.Substring(colon+1).Trim();}}
          string origin,host,auth,length,type;
          // Consume a bounded request body before replying (also on rejection),
          // otherwise Windows can reset the socket and truncate the error JSON.
          int size=0;
          if(headers.TryGetValue("Content-Length",out length)&&(!Int32.TryParse(length,out size)||size<0||size>10*1024*1024))return;
          byte[] body=new byte[size];int read=0;
          while(read<size){int count=stream.Read(body,read,size-read);if(count==0)return;read+=count;}
          if(first.Length!=3||!headers.TryGetValue("Origin",out origin)||origin!=Origin||!headers.TryGetValue("Host",out host)||host!="127.0.0.1:"+Port){Reply(stream,403,new{error="เว็บไซต์ไม่ได้รับอนุญาต"},false);return;}
          if(first[0]=="OPTIONS"){Reply(stream,204,null,true);return;}
          if(first[0]!="POST"||headers.ContainsKey("Transfer-Encoding")||!headers.TryGetValue("Authorization",out auth)||!Authorized(auth)){Reply(stream,403,new{error="กรุณาเชื่อมต่อตัวช่วยพิมพ์จากหน้าตั้งค่าการพิมพ์"},true);return;}
          if(size<2||!headers.TryGetValue("Content-Type",out type)||!type.StartsWith("application/json",StringComparison.OrdinalIgnoreCase)){Reply(stream,400,new{error="คำขอไม่ถูกต้องหรือเอกสารใหญ่เกินไป"},true);return;}
          try{Reply(stream,200,Handle(first[1],new UTF8Encoding(false,true).GetString(body)),true);}
          catch(Exception ex){Reply(stream,400,new{error=ex is InvalidOperationException?ex.Message:"อ่านหรือบันทึกข้อมูลพิมพ์ไม่สำเร็จ กรุณาตรวจพื้นที่ว่างและเปิดตัวช่วยใหม่"},true);}
        }}catch(IOException){}catch(SocketException){}catch(ObjectDisposedException){}
      }
    }
    static void Reply(Stream stream,int status,object value,bool cors){
      byte[] body=value==null?new byte[0]:Encoding.UTF8.GetBytes(Data.Json(value));
      string headers="HTTP/1.1 "+status+" "+(status==200?"OK":status==204?"No Content":"Error")+"\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\n";
      if(cors)headers+="Access-Control-Allow-Origin: "+Origin+"\r\nVary: Origin\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\n";
      byte[] head=Encoding.ASCII.GetBytes(headers+"Content-Length: "+body.Length+"\r\n\r\n");stream.Write(head,0,head.Length);stream.Write(body,0,body.Length);
    }
  }
}
