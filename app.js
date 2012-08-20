
/**
 * Module dependencies.
 */

var express = require('express')
  , routes  = require('./routes')
  , redis   = require('redis')
  , _       = require('underscore')
  , fs      = require('fs');

var app = module.exports = express.createServer();

// Configuration

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.set('view options', { layout: false });
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
  app.use(express.errorHandler());
});

var port = process.argv[2];

// Routes

app.get('/', routes.index);

app.listen(port);
console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);

var everyone = require("now").initialize(app);

fs.readFile('settings.json', 'utf-8', function(err, data){
  var settings = JSON.parse(data);
  var redisClients = {};

  _.each(settings, function(v,k){
    redisClients[k] = redis.createClient(v['port'], v['host']);
  });

  everyone.now.QueueSnapshot = function(instanceName, queueName, previousData, callback){
    var queueKeyBase = 'redis:queue:' + queueName + ':queue'
      , redisClient  = redisClients[instanceName];
    if(_.isUndefined(previousData) || _.isNull(previousData))
      previousData = { previousLength: 0, previousMaxScore: 0  };
      redisClient.multi()
        .zcard(queueKeyBase)
        .zcount(queueKeyBase, '(' + (previousData.previousMaxScore || 0),'+inf')
        .zrevrange(queueKeyBase,0,0)
        .exec(function(err,replies){
          redisClient.zscore(queueKeyBase,parseInt(replies[2][0]), function(err,res){
            result = { items: replies[0], newItems: replies[1], removedItems: (previousData.previousLength + replies[1] - replies[0]) };
            newPreviousData = { previousLength: replies[0], previousMaxScore: parseFloat(res) };
            callback(result, newPreviousData);
          });
        });
  }

  everyone.now.getItems = function(instanceName, queueName, count, callback){
    var queueKeyBase = 'redis:queue:' + queueName
      , redisClient  = redisClients[instanceName];
    redisClient.zrange(queueKeyBase + ':queue', 0, count -1, function(err, fields){
      redisClient.hmget(queueKeyBase + ':values', fields, function(e,res){
        callback(_.zip(fields,res));
      })
    });
  }

  everyone.now.getQueues = function(instanceName, callback){
    var queueKeyBase = 'redis:queue:'
      , redisClient  = redisClients[instanceName];
    redisClient.smembers(queueKeyBase + 'set', function(err, res){
      callback(_.collect(res, function(q){ return { name: q } }));
    });
  }

  everyone.now.getInstances = function(callback){
    callback(_.keys(redisClients));
  }

});
