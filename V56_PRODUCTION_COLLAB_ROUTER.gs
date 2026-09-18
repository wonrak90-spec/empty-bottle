/**
 * V56 Production Collaboration router adapter.
 * Call AFTER existing session authentication and pass the authenticated user as actor.
 */

function routeProductionCollabGetV56_(action, params, actor) {
  action = String(action || '');
  params = params || {};

  if (action === 'productionCollabList') {
    return {handled:true,result:listProductionCollabV56_(actor)};
  }
  return {handled:false};
}

function routeProductionCollabPostV56_(action, payload, actor) {
  action = String(action || '');
  payload = payload || {};

  if (action === 'productionCollabOpen') {
    return {handled:true,result:openProductionCollabV56_(payload,actor)};
  }
  if (action === 'productionCollabJoin') {
    return {handled:true,result:joinProductionCollabV56_(payload,actor)};
  }
  if (action === 'productionCollabTouch') {
    return {handled:true,result:touchProductionCollabV56_(payload,actor)};
  }
  if (action === 'productionCollabClose') {
    return {handled:true,result:closeProductionCollabV56_(payload,actor)};
  }
  return {handled:false};
}
