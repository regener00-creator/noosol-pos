module.exports=async function dragTopic(page,source,target,hold=false){
  const title=source.locator('.note-list-title');
  await title.scrollIntoViewIfNeeded();
  const start=await title.boundingBox();
  const end=await target.boundingBox();
  await page.mouse.move(start.x+start.width/2,start.y+start.height/2);
  await page.mouse.down();
  if(hold)await page.locator('.topic-lifting').waitFor({timeout:2000});
  await page.mouse.move(end.x+end.width/2,end.y+end.height/2,{steps:5});
  await page.locator('.topic-before,.topic-after').waitFor({timeout:1200});
  await page.mouse.up();
};
