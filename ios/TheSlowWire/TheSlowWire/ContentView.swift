//
//  ContentView.swift
//  TheSlowWire
//
//  Created by Özkan Selçuk on 22/08/2026.
//

import SwiftUI

struct ContentView: View {
    @State private var selection: Vertical = .ai

    var body: some View {
        TabView(selection: $selection) {
            ForEach(Vertical.allCases) { vertical in
                SectionView(vertical: vertical)
                    .tag(vertical)
                    .tabItem {
                        Label(vertical.title, systemImage: vertical.symbol)
                    }
            }
        }
        .tint(selection.color)
    }
}

struct SectionView: View {
    let vertical: Vertical

    var body: some View {
        NavigationStack {
            ZStack {
                Color.paper.ignoresSafeArea()
                VStack(spacing: 12) {
                    Image(systemName: vertical.symbol)
                        .font(.system(size: 44))
                        .foregroundStyle(vertical.color)
                    Text(vertical.title)
                        .font(.largeTitle.bold())
                        .foregroundStyle(Color.ink)
                    Text("Stories will load here.")
                        .foregroundStyle(Color.ink.opacity(0.6))
                }
            }
            .navigationTitle(vertical.title)
        }
    }
}

#Preview {
    ContentView()
}
