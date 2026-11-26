// override route sha256:fd12934aa790b43171417b54c35c082f6100c512657d890b25920432816d1f5f in cloud/gateway.mjs
// a fixture gateway, routed by 10-each's override
function route(p) { return `routed ${p}`; }
