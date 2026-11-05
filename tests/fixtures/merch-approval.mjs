// Synthetic local-only approvals. Never import these into production config.
export function futureMerchFixture(now,{enabled=false}={}){
  const url='https://streamlabs.com/fixture/merch/123';
  const record={id:'fixture_merch_0001',channel:'123',url,kind:'merch',status:'approved',
    reviewedBy:'fixture-reviewer',evidence:'SYNTHETIC-NOT-A-REAL-APPROVAL',
    reviewedAt:now-1,redirectsCheckedAt:now-1,expiresAt:now+60000,
    ownership:{status:'verified',channel:'123',brandOwnerChannel:'123',provider:'streamlabs',
      storeId:'fixture',productId:'123',productKind:'physical',productUrl:url,
      evidence:'SYNTHETIC-STORE-CONTROL',brandEvidence:'SYNTHETIC-OWN-BRAND',verifiedAt:now-1,expiresAt:now+60000}};
  const clearance={status:'approved',scope:'owned-branded-physical-merch',extensionId:'fixtureclient',
    reference:'SYNTHETIC-NOT-TWITCH-PERMISSION',reviewedBy:'fixture-reviewer',channels:['123'],verifiedAt:now-1,expiresAt:now+60000};
  return {record,clearance,env:{STUDIO_ENABLED:'true',TEST_CHANNELS:'123',EXTENSION_CLIENT_ID:'fixtureclient',
    ...(enabled?{MERCH_ENABLED:'true'}:{}),MERCH_TWITCH_CLEARANCE:JSON.stringify(clearance),OUTBOUND_LINK_REVIEWS:JSON.stringify([record])}};
}
