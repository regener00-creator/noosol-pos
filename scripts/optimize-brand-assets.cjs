// Lossless format conversion only: do not resize or alter brand artwork.
const fs=require('node:fs');
const path=require('node:path');
const sharp=require(process.env.SAPURI_SHARP_MODULE||'sharp');
const root=path.resolve(__dirname,'..');
(async()=>{
  for(const name of ['sapuri-brand-logo','sapuri-pharmacy-logo']){
    const input=fs.readFileSync(path.join(root,`${name}.png`));
    const output=await sharp(input).webp({lossless:true,effort:6}).toBuffer();
    const original=await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const converted=await sharp(output).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    if(JSON.stringify(original.info)!==JSON.stringify(converted.info)||!original.data.equals(converted.data)) throw new Error(`${name}: pixel mismatch`);
    if(output.length>=input.length) throw new Error(`${name}: no size improvement`);
    fs.writeFileSync(path.join(root,`${name}.webp`),output);
    console.log(`${name}: ${input.length} -> ${output.length} bytes; decoded pixels identical`);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
