// GeologySystem.js
import * as THREE from 'three';
import { Brush } from 'three-bvh-csg';

export class GeologySystem {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.scene.add(this.group);
        this.layerBrushes = []; // 存储用于运算的实体画笔
        this.displayMeshes = []; // 存储用于显示的网格
        
        // 地层配置 (高饱和度工程色)
        this.layersConfig = [
            { name: "基岩 (Bedrock)", color: 0x2c3e50, height: 200 },
            { name: "深层土 (Deep Soil)", color: 0x27ae60, height: 150 },
            { name: "粘土层 (Clay)",   color: 0xc0392b, height: 100 },
            { name: "砂层 (Sand)",     color: 0xf39c12, height: 80 },
            { name: "含水层 (Aqua)",   color: 0x2980b9, height: 60 },
            { name: "表土 (Topsoil)",  color: 0x16a085, height: 40 }
        ];

        // 几何参数
        this.width = 2500;
        this.depth = 800;
        this.segW = 40; 
        this.segD = 15;
    }

    init() {
        this.rebuild();
    }

    rebuild() {
        // 清理旧数据
        this.layerBrushes = [];
        while(this.group.children.length > 0) {
            const child = this.group.children[0];
            if(child.geometry) child.geometry.dispose();
            this.group.remove(child);
        }
        this.displayMeshes = [];

        // 1. 生成连续的高度界面 (保证紧密无缝)
        const interfaces = [];
        let currentY = -400; 
        interfaces.push(this._generateHeightMap(currentY, 0)); // 底面

        this.layersConfig.forEach(layer => {
            currentY += layer.height;
            interfaces.push(this._generateHeightMap(currentY, 35)); // 每一层的起伏
        });

        // 2. 构建每一层的实体
        this.layersConfig.forEach((layer, i) => {
            const geo = this._buildSolidGeometry(interfaces[i], interfaces[i+1]);
            
            // 材质：FlatShading 带来硬朗工程风
            const mat = new THREE.MeshPhongMaterial({
                color: layer.color,
                flatShading: true,
                shininess: 30,
                specular: 0x111111
            });

            // 创建 CSG Brush (运算用)
            const brush = new Brush(geo, mat);
            brush.updateMatrixWorld();
            this.layerBrushes.push(brush);

            // 创建显示 Mesh (渲染用)
            const mesh = brush.clone();
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.group.add(mesh);
            this.displayMeshes.push(mesh);

            // 添加黑色轮廓线 (清晰度关键)
            const edges = new THREE.EdgesGeometry(geo, 25);
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.4, transparent: true }));
            mesh.add(line);
        });
    }

    // 更新地层网格 (被挖洞后调用)
    updateLayerMesh(index, newGeometry) {
        if(this.displayMeshes[index]) {
            const mesh = this.displayMeshes[index];
            mesh.geometry.dispose();
            mesh.geometry = newGeometry;

            // 重新生成轮廓线
            if(mesh.children.length > 0) {
                const line = mesh.children[0];
                line.geometry.dispose();
                line.geometry = new THREE.EdgesGeometry(newGeometry, 25);
            }
        }
    }

    // --- 内部算法 ---
    _generateHeightMap(baseY, intensity) {
        const map = [];
        const offset = Math.random() * 100;
        for(let i=0; i<=this.segW; i++) {
            const row = [];
            for(let j=0; j<=this.segD; j++) {
                const x = i/this.segW; const z = j/this.segD;
                const h = baseY + Math.sin(x*5 + offset)*intensity + Math.cos(z*3)*intensity*0.5;
                row.push(h);
            }
            map.push(row);
        }
        return map;
    }

    _buildSolidGeometry(botMap, topMap) {
        const verts = []; const idx = [];
        const gw = this.width/this.segW; const gd = this.depth/this.segD;
        const ox = -this.width/2; const oz = -this.depth/2;

        for(let i=0; i<=this.segW; i++) {
            for(let j=0; j<=this.segD; j++) {
                const x = ox + i*gw; const z = oz + j*gd;
                verts.push(x, topMap[i][j], z); // Top vertex
                verts.push(x, botMap[i][j], z); // Bot vertex
            }
        }
        
        const rowStep = (this.segD + 1) * 2; 
        for(let i=0; i<this.segW; i++) {
            for(let j=0; j<this.segD; j++) {
                const a = i*rowStep + j*2;     // Top-Left
                const b = a + 1;               // Bot-Left
                const c = a + 2;               // Top-Right
                const d = a + 3;               // Bot-Right
                const nextRow = (i+1)*rowStep + j*2;
                const A = nextRow, B = A + 1, C = A + 2, D = A + 3;

                idx.push(a, c, A, c, C, A); // Top
                idx.push(b, B, d, d, B, D); // Bot
                if(j===0) idx.push(a, A, b, A, B, b); // Front
                if(j===this.segD-1) idx.push(c, d, C, d, D, C); // Back
            }
        }
        // Left & Right
        for(let j=0; j<this.segD; j++) {
            const a = j*2, b=a+1, c=a+2, d=a+3; 
            idx.push(c,b,a, d,b,c);
            const start = this.segW*rowStep + j*2;
            const A=start, B=start+1, C=start+2, D=start+3;
            idx.push(A,B,C, C,B,D);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        return geo;
    }
}