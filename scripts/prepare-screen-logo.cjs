// One-off screen derivative. Original artwork remains unchanged for printing.
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
  const root=path.join(__dirname,'..');
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>file&&fs.existsSync(file))||chromium.executablePath();
  const browser=await chromium.launch({headless:true,executablePath});
  try{
    const page=await browser.newPage();
    const result=await page.evaluate(async data=>{
      const img=new Image();img.src=data;await img.decode();
      const canvas=document.createElement('canvas');
      const scale=Math.min(1,384/Math.max(img.width,img.height));
      canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);
      const ctx=canvas.getContext('2d');ctx.imageSmoothingQuality='high';ctx.drawImage(img,0,0,canvas.width,canvas.height);
      return canvas.toDataURL('image/webp',0.92);
    },'data:image/webp;base64,'+fs.readFileSync(path.join(root,'sapuri-brand-logo.webp')).toString('base64'));
    if(!result.startsWith('data:image/webp;base64,')) throw new Error('WebP encoding unavailable');
    const output=Buffer.from(result.split(',')[1],'base64');
    fs.writeFileSync(path.join(root,'sapuri-brand-screen.webp'),output);
    console.log(`Screen logo: ${output.length} bytes; original print artwork retained`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
