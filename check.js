import { MongoClient } from "mongodb";
async function checkVersion() {
    const client = new MongoClient('mongodb://10.128.60.46:27017/');
    await client.connect();
    const db = client.db('krph_db');
    db.sla_records.find({Customer_pulse: {$exists:true}}).forEach( function(x) {
        db.sla_records.update({_id: x._id}, {$set: {Customer_pulse: parseInt(x.Customer_pulse)}});
    });

    client.close()
}

checkVersion();