module.exports=async function dragTopic(page,source,target){
  const grip=source.locator('.topic-grip');
  await grip.scrollIntoViewIfNeeded();
  const start=await grip.boundingBox();
  const end=await target.boundingBox();
  await page.mouse.move(start.x+start.width/2,start.y+start.height/2);
  await page.mouse.down();
  await page.locator('.topic-lifting').waitFor({timeout:2000});
  await page.mouse.move(end.x+end.width/2,end.y+end.height/2,{steps:5});
  await page.mouse.up();
};
